//! This file contains the "outer" logic of whisper decoding.
//! I.e. everything that is not backend (the number crunching part) specific.
//! It does stuff like coordinate beamsearch, initiate the word level timestamp reconstruction
//! and feeding audio chunks to the backend. The interface between it and the backend is the
//! WhisperDecoderBackend trait.

use std::time::Instant;

use crate::{
    audio_reader::AudioReader,
    whisper::{
        decoder::{
            WhisperDecoderOrt, WhisperDecoderOrtAudioChunkHandle, WhisperDecoderOrtSequenceHandle,
        },
        encoder::WhisperEncoderOrt,
        tokenizer::Tokenizer,
    },
};
use anyhow::Result;
use compute::functions::softmax;
use ndarray::Array2;

pub trait WhisperDecoderBackend<AudioChunkHandle, SequenceHandle> {
    /// Registers a new audio chunk with the backend.
    /// This method is here to potentially do gpu upload.
    /// The `AudioChunkHandle` is backend specific and holds the gpu buffer as well as the cross
    /// attention KV cache.
    /// chunk usually has the shape [1500,1280]
    async fn register_encoded_audio_chunks(
        &mut self,
        chunks: impl ExactSizeIterator<Item = Array2<f32>>,
    ) -> Result<Vec<AudioChunkHandle>>;

    /// Registers a new sequence with the backend.
    /// The `SequenceHandle` is backend specific and holds the buffer of the sequence as well as
    /// the self attention KV cache of this sequence.
    async fn register_sequence(&mut self, tokens: &[i64]) -> SequenceHandle;

    /// appends a token to the given sequence
    async fn append_token_to_sequence(
        &mut self,
        seq: &SequenceHandle,
        conf: f32,
        token: i64,
    ) -> SequenceHandle;

    /// returns the product of the confidence of all tokens in this sequence
    fn seq_conf(&self, seq: &SequenceHandle) -> f64;

    fn get_tokens(&self, seq: &SequenceHandle) -> Result<Vec<(f32, i64)>>;

    // Run a single forward pass of the decoder.
    async fn forward(
        &mut self,
        inputs: &[(AudioChunkHandle, SequenceHandle)],
    ) -> Result<Vec<(SequenceHandle, TokenProbs)>>;
}

pub struct TokenProbs {
    pub logits: Vec<f32>,
}
impl TokenProbs {
    pub fn probs(&self) -> Vec<f64> {
        let logits_f64: Vec<f64> = self.logits.iter().map(|x| *x as f64).collect();
        softmax(&logits_f64)
    }
}

pub struct WhisperBar {
    atoms: Vec<Atom>,
}

#[derive(Debug)]
pub struct Atom {
    pub conf: f32,
    pub conf_ts: f32,
    pub start: f32,
    pub end: f32,
    pub text: String,
}

pub struct Whisper {
    encoder: WhisperEncoderOrt,
    decoder: WhisperDecoderOrt,
    tokenizer: Tokenizer,
}
impl Whisper {
    // idea: make the beam_width only wider if we are unsure about the next token. otherwise greedy is fine
    const BEAM_WIDTH: usize = 5;

    pub async fn new() -> Result<Self> {
        let encoder = WhisperEncoderOrt::new().await?;
        let decoder = WhisperDecoderOrt::new().await?;
        let tokenizer = Tokenizer::new().await?;

        Ok(Self {
            encoder,
            decoder,
            tokenizer,
        })
    }

    pub async fn transcribe(
        &mut self,
        ar: &AudioReader,
        _on_new_bar: &mut dyn FnMut(WhisperBar),
    ) -> Result<()> {
        let audio_frames = ar.len().min(16_000 * 30);
        let audio_len_s = audio_frames as f32 / 16_000.0;
        let samples = ar.get(0..audio_frames)?;
        let start = Instant::now();
        let encoded = self.encoder.encode(samples.to_vec())?;
        let handles = self
            .decoder
            .register_encoded_audio_chunks([encoded].into_iter())
            .await?;
        self.transcribe_chunks(&handles).await?;
        let duration = start.elapsed().as_secs_f32();
        println!(
            "transcription of the first {audio_len_s:.2}s took {duration:.2}s ({:.2}x realtime)",
            audio_len_s / duration
        );
        Ok(())
    }

    pub async fn transcribe_chunks(
        &mut self,
        chunks: &[WhisperDecoderOrtAudioChunkHandle],
    ) -> Result<Vec<Vec<Atom>>> {
        let start = Instant::now();
        let mut batch = Vec::new();
        for chunk in chunks {
            let sot_sequence = self.tokenizer.sot_sequence("en")?;
            let start_seq = self.decoder.register_sequence(&sot_sequence).await;
            batch.push((chunk.clone(), vec![start_seq]));
        }

        let mut finished: Vec<Vec<WhisperDecoderOrtSequenceHandle>> =
            chunks.iter().map(|_| Vec::new()).collect();
        loop {
            let start = Instant::now();
            let mut decoder_input = Vec::new();
            for (chunk, beam) in &batch {
                for seq in beam {
                    decoder_input.push((chunk.clone(), seq.clone()));
                }
            }
            if decoder_input.is_empty() {
                break;
            }
            let result = self.decoder.forward(&decoder_input).await?;

            let mut next_batch = Vec::new();
            let mut result_idx = 0;
            for (batch_idx, (chunk, beam)) in batch.iter().enumerate() {
                // inside this for loop happens beam search
                let mut next_beam = Vec::new();
                let mut best: TopNVec<(&WhisperDecoderOrtSequenceHandle, usize, f64)> =
                    TopNVec::new(Self::BEAM_WIDTH - finished[batch_idx].len());
                for _ in beam.iter() {
                    let (seq, token_probs) = &result[result_idx];
                    result_idx += 1;
                    let seq_base_prob = self.decoder.seq_conf(seq);
                    for (token, prob) in token_probs.probs().into_iter().enumerate() {
                        let total_prob = seq_base_prob * prob;
                        best.insert(total_prob, (seq, token, prob));
                    }
                }

                for &(seq, token, conf) in best.iter() {
                    let seq = self
                        .decoder
                        .append_token_to_sequence(seq, conf as f32, token as i64)
                        .await;
                    let tokens: Vec<i64> = self
                        .decoder
                        .get_tokens(&seq)?
                        .iter()
                        .map(|(_prob, t)| *t)
                        .collect();
                    println!("{}", self.tokenizer.decode(&tokens)?);

                    if token as i64 == self.tokenizer.endoftext() {
                        println!("tokens: {}", self.decoder.get_tokens(&seq)?.len());
                        finished[batch_idx].push(seq);
                    } else {
                        next_beam.push(seq);
                    }
                }
                println!();
                next_batch.push((chunk.clone(), next_beam));
            }
            batch = next_batch;
            println!("loop iteration: {:?}\n", start.elapsed());
        }

        let to_return = Vec::new();
        for (_chunk, seqs) in chunks.iter().zip(finished) {
            let _best = seqs
                .iter()
                .max_by(|seq_a, seq_b| {
                    self.decoder
                        .seq_conf(seq_a)
                        .total_cmp(&self.decoder.seq_conf(seq_b))
                })
                .unwrap();
            //let atoms = self.decoder.token_sequence_to_atoms(best, chunk).await?;
            //to_return.push(atoms);
        }
        println!("transcribe_chunks took {:?}", start.elapsed());
        Ok(to_return)
    }
}

/// A datastructure that only stores the top N entries
#[derive(Debug)]
pub struct TopNVec<T> {
    pub n: usize,
    pub min: f64,
    pub data: Vec<(f64, T)>,
}
impl<T> TopNVec<T> {
    fn new(n: usize) -> Self {
        Self {
            n,
            min: f64::INFINITY,
            data: Vec::new(),
        }
    }

    fn insert(&mut self, score: f64, value: T) {
        if self.data.len() < self.n {
            self.data.push((score, value));
            self.min = self.min.min(score);
        } else if score > self.min {
            let current_min_idx = self
                .data
                .iter()
                .enumerate()
                .min_by(|(_, (a, _)), (_, (b, _))| a.total_cmp(b))
                .unwrap()
                .0;
            self.data[current_min_idx] = (score, value);
            self.min = score;
        }
    }

    fn iter(&self) -> impl ExactSizeIterator<Item = &T> {
        self.data.iter().map(|(_, v)| v)
    }
}

fn atoms_to_text(atoms: &[Atom]) -> String {
    let mut to_return = String::new();
    for a in atoms {
        to_return.push_str(&a.text);
    }
    to_return
}

#[cfg(test)]
mod test {
    use super::*;

    #[tokio::test]
    async fn test_transcribe() {
        let ar = AudioReader::new("../worker/tests/data/sample.mp3").unwrap();
        let mut whisper = Whisper::new().await.unwrap();
    }
}
