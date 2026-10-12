//! This file contains the "outer" logic of whisper decoding.
//! I.e. everything that is not backend (the number crunching part) specific.
//! It does stuff like coordinate beamsearch, initiate the word level timestamp reconstruction
//! and feeding audio chunks to the backend. The interface between it and the backend is the
//! WhisperDecoderBackend trait.

use std::time::Instant;

use crate::{
    audio_reader::AudioReader,
    whisper::{
        decoder::{AlignmentData, TokenSequence, WhisperDecoderBackend},
        decoder_onnx::{AudioChunkHandle, SequenceHandle, WhisperDecoderOrt},
        encoder_onnx::WhisperEncoderOrt,
        math::softmax,
        tokenizer::Tokenizer,
    },
};
use anyhow::Result;
use log::{debug, info};
use ndarray::{Array2, Axis, s};

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
    const MAX_LEN: usize = 448;

    pub async fn new() -> Result<Self> {
        let start = Instant::now();
        let encoder = WhisperEncoderOrt::new().await?;
        let decoder = WhisperDecoderOrt::new().await?;
        let tokenizer = Tokenizer::new().await?;
        info!("Model loading took {:?}", start.elapsed());

        Ok(Self {
            encoder,
            decoder,
            tokenizer,
        })
    }

    pub fn transcribe(
        &mut self,
        ar: &AudioReader,
        on_new_bar: &mut dyn FnMut(WhisperBar),
    ) -> Result<()> {
        let audio_frames = ar.len().min(16_000 * 30);
        let audio_len_s = audio_frames as f32 / 16_000.0;
        let samples = ar.get(0..audio_frames)?;
        let start = Instant::now();
        let encoded = self.encoder.encode(samples.to_vec())?;
        let handles = self
            .decoder
            .register_encoded_audio_chunks([encoded].into_iter())?;
        let sot_sequence = self.tokenizer.sot_sequence("en")?;

        self.transcribe_chunks(&[(handles[0].clone(), sot_sequence)])?;
        let duration = start.elapsed().as_secs_f32();
        info!(
            "transcription of the first {audio_len_s:.2}s took {duration:.2}s ({:.2}x realtime)",
            audio_len_s / duration
        );
        Ok(())
    }

    /// This function transcribes one chunk of audio with beam search and decides on one concrete
    /// beam. It does not yet do timing reconstruction but only returns the data for that.
    ///
    /// `x` contains AudioChunks and Prompts.
    pub fn transcribe_chunks(
        &mut self,
        x: &[(AudioChunkHandle, Vec<i64>)],
    ) -> Result<Vec<(TokenSequence, AlignmentData)>> {
        let start = Instant::now();
        let mut batch = Vec::new();
        for (chunk, prompt) in x {
            let start_seq = self.decoder.register_sequence(&prompt);
            batch.push((chunk.clone(), vec![start_seq]));
        }

        let mut finished: Vec<Option<(TokenSequence, AlignmentData)>> = vec![None; x.len()];
        loop {
            let loop_start = Instant::now();
            let decoder_input: Vec<_> = batch
                .iter()
                .flat_map(|(chunk, beam)| beam.iter().map(|seq| (chunk.clone(), seq.clone())))
                .collect();
            if decoder_input.is_empty() {
                break;
            }
            let result = self.decoder.forward(&decoder_input)?;
            let last_axis = Axis(result.shape().len() - 1);
            let token_probs: Array2<f32> = softmax(result.into_dyn(), last_axis)
                .into_dimensionality()
                .unwrap();

            let mut next_batch = Vec::new();
            let mut result_idx = 0;
            for (batch_idx, (chunk, beam)) in batch.iter().enumerate() {
                // inside this for loop happens beam search
                let mut next_beam = Vec::new();
                let mut best: TopNVec<(&SequenceHandle, usize, f32)> =
                    TopNVec::new(Self::BEAM_WIDTH);
                for seq in beam.iter() {
                    let token_probs = token_probs.slice(s![result_idx, ..]);
                    result_idx += 1;

                    let seq_base_logprob = Self::logprob_of_seq(&self.decoder.get_tokens(seq)?);
                    for (token, &prob) in token_probs.iter().enumerate() {
                        let total_logprob = seq_base_logprob + prob.ln();
                        best.insert(total_logprob, (seq, token, prob));
                    }
                }

                for &(seq, token, conf) in best.iter() {
                    let seq = self
                        .decoder
                        .append_token_to_sequence(seq, token as i64, conf)?;
                    let tokens = self.decoder.get_tokens(&seq)?;

                    let only_tokens: Vec<_> = tokens.iter().map(|(t, _)| *t).collect();
                    debug!(
                        "{} {}",
                        self.tokenizer.decode(&only_tokens)?,
                        Self::logprob_of_seq(&tokens)
                    );

                    let is_better_than_finished = match &finished[batch_idx] {
                        Some((finished, _)) => {
                            Self::logprob_of_seq(&tokens) > Self::logprob_of_seq(&finished)
                        }
                        None => true,
                    };
                    if is_better_than_finished {
                        if token as i64 == self.tokenizer.endoftext()
                            || tokens.len() >= Self::MAX_LEN
                        {
                            let alignment_data = self.decoder.get_alignment_data(&seq)?;
                            finished[batch_idx] = Some((tokens, alignment_data));
                        } else {
                            next_beam.push(seq);
                        }
                    }
                }
                next_batch.push((chunk.clone(), next_beam));
            }
            batch = next_batch;
            debug!("loop iteration: {:?}\n", loop_start.elapsed());
        }

        info!("decoder took {:?}", start.elapsed());
        Ok(finished.into_iter().map(|x| x.unwrap()).collect())
    }

    fn logprob_of_seq(x: &TokenSequence) -> f32 {
        x.iter().map(|(_, c)| c.ln()).sum()
    }
}

/// A datastructure that only stores the top N entries
#[derive(Debug)]
pub struct TopNVec<T> {
    pub n: usize,
    pub min: f32,
    pub data: Vec<(f32, T)>,
}
impl<T> TopNVec<T> {
    fn new(n: usize) -> Self {
        Self {
            n,
            min: f32::INFINITY,
            data: Vec::new(),
        }
    }

    fn insert(&mut self, score: f32, value: T) {
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
