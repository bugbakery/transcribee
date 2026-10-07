//! This file contains the "outer" logic of whisper decoding.
//! I.e. everything that is not backend (the number crunching part) specific.
//! It does stuff like coordinate beamsearch, initiate the word level timestamp reconstruction
//! and feeding audio chunks to the backend. The interface between it and the backend is the
//! WhisperDecoderBackend trait.

use crate::{
    audio_reader::AudioReader,
    whisper::{decoder::WhisperDecoderOrt, encoder::WhisperEncoderOrt, tokenizer::Tokenizer},
};
use anyhow::Result;
use ndarray::Array2;

pub trait WhisperDecoderBackend<AudioChunkHandle, SequenceHandle> {
    /// Registers a new audio chunk with the backend.
    /// This method is here to potentially do gpu upload.
    /// The `AudioChunkHandle` is backend specific and holds the gpu buffer as well as the cross
    /// attention KV cache.
    /// chunk usually has the shape [1500,1280]
    async fn register_encoded_audio_chunk(&mut self, chunk: Array2<f32>) -> AudioChunkHandle;

    /// Registers a new sequence with the backend.
    /// The `SequenceHandle` is backend specific and holds the buffer of the sequence as well as
    /// the self attention KV cache of this sequence.
    async fn register_sequence(&mut self, tokens: &[i64]) -> SequenceHandle;

    /// appends a token to the given sequence
    async fn append_token_to_sequence(
        &mut self,
        seq: &SequenceHandle,
        token: i64,
    ) -> SequenceHandle;

    /// convert a SequenceHandle to Atoms.
    /// This executes word alignment.
    async fn token_sequence_to_atoms(
        &self,
        seq: &SequenceHandle,
        audio_length_encoder_frames: usize,
    ) -> Result<Vec<Atom>>;

    // Run a single forward pass of the decoder.
    async fn forward(
        &mut self,
        inputs: &[(AudioChunkHandle, SequenceHandle)],
    ) -> Result<Vec<(SequenceHandle, TokenProbs)>>;
}

pub struct TokenProbs {
    pub logits: Vec<f32>,
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
    pub async fn new(src: AudioReader) -> Result<Self> {
        let encoder = WhisperEncoderOrt::new(src).await?;
        let decoder = WhisperDecoderOrt::new().await?;
        let tokenizer = Tokenizer::new().await?;

        Ok(Self {
            encoder,
            decoder,
            tokenizer,
        })
    }

    pub async fn transcribe(_on_new_bar: &mut dyn FnMut(WhisperBar)) -> Result<()> {
        Ok(())
    }

    pub async fn transcribe_chunk(&mut self) -> Result<Vec<Atom>> {
        let audio_frames = self.encoder.len().min(16_000 * 30);
        let encoded = self.encoder.get(0..audio_frames)?;
        let encoded_frames = audio_frames / 320;
        let audio_chunk = self.decoder.register_encoded_audio_chunk(encoded).await;
        let sot_sequence = self.tokenizer.sot_sequence("en")?;
        let start_seq = self.decoder.register_sequence(&sot_sequence).await;

        let mut next_seq = Some(start_seq);
        loop {
            let mut result = self
                .decoder
                .forward(&[(audio_chunk.clone(), next_seq.take().unwrap())])
                .await?;
            let (seq, token_probs) = result.pop().unwrap();

            // greedy sample the best token
            let (next_token, _) = token_probs
                .logits
                .iter()
                .enumerate()
                .max_by(|(_, a), (_, b)| a.total_cmp(b))
                .unwrap();
            next_seq = Some(
                self.decoder
                    .append_token_to_sequence(&seq, next_token as i64)
                    .await,
            );
            if next_token as i64 == self.tokenizer.endoftext() {
                break;
            }
        }
        let seq = next_seq.take().unwrap();
        Ok(self
            .decoder
            .token_sequence_to_atoms(&seq, encoded_frames)
            .await?)
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[tokio::test]
    async fn test_transcribe() {
        let ar = AudioReader::new("../worker/tests/data/sample.mp3").unwrap();
        let mut whisper = Whisper::new(ar).await.unwrap();

        dbg!(whisper.transcribe_chunk().await);
    }
}
