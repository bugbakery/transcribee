//! This file contains the Interface description of whisper decoder backends.
//! A backend handles all the number crunching, kv-cache management but none of the actual decoding
//! logic. This makes it possible to (potentially) write different backends for the performance)
//! sensitive part while keeping complexity in check.

use std::{any::Any, sync::Arc};

use anyhow::Result;
use log::error;
use ndarray::{Array2, Array3};

use crate::whisper::onnx_backend::{
    Backend::{CPU, WebGPU},
    decoder::WhisperDecoderOrt,
};

pub type TokenSequence = Vec<(i64, f32)>; // token, conf
pub type AlignmentData = Array3<f32>; // [heads, tokens, encoder_frames]
pub type DynWhisperDecoderBackend = Box<dyn WhisperDecoderBackend>;

pub fn get_backends(model_folder: &str) -> Vec<DynWhisperDecoderBackend> {
    let mut backends: Vec<DynWhisperDecoderBackend> = vec![];
    match WhisperDecoderOrt::new(CPU, model_folder) {
        Ok(backend) => backends.push(Box::new(backend)),
        Err(e) => error!("error initializing encoder ort CPU backend: {e}"),
    };
    match WhisperDecoderOrt::new(WebGPU, model_folder) {
        Ok(backend) => backends.push(Box::new(backend)),
        Err(e) => error!("error initializing encoder ort WebGPU backend: {e}"),
    };
    backends
}

#[derive(Clone)]
pub struct AudioChunkHandle(pub Arc<dyn Any>);
impl AudioChunkHandle {
    pub fn downcast<T: 'static>(x: T) -> Self {
        Self(Arc::new(x))
    }
    pub fn upcast<T: 'static>(&self) -> &T {
        self.0.downcast_ref().as_ref().unwrap()
    }
}

#[derive(Clone)]
pub struct SequenceHandle(pub Arc<dyn Any>);
impl SequenceHandle {
    pub fn downcast<T: 'static>(x: T) -> Self {
        Self(Arc::new(x))
    }
    pub fn upcast<T: 'static>(&self) -> &T {
        self.0.downcast_ref().as_ref().unwrap()
    }
}

pub trait WhisperDecoderBackend {
    /// Registers audio chunks with the backend. This method is here to potentially do gpu upload.
    /// The `AudioChunkHandle` is backend specific and holds the gpu buffer as well as the cross attention KV cache.
    /// The Handles handed out here are only valid until register_encoded_audio_chunks() is called for the next time.
    /// chunks usually have the shape [1500,1280]
    fn register_encoded_audio_chunks(
        &mut self,
        chunks: &[Array2<f32>],
    ) -> Result<Vec<AudioChunkHandle>>;

    /// Registers a new text sequence with the backend. All tokens passed to this function are assumed to have a confidence of 1.0.
    /// The `SequenceHandle` is backend specific and holds the buffer of the sequence as well as a reference to
    /// the self attention KV cache and alignment data of this sequence.
    /// The KV cache and alignment data are only guaranteed to be usable after forward() has been called and will
    /// be overwritten by the next call to forward()
    fn register_sequence(&mut self, tokens: &[i64]) -> SequenceHandle;

    /// Appends a token to the given sequence and returns the new sequence.
    /// This function should be called exactly once per sequence between each call to forward().
    fn append_token_to_sequence(
        &mut self,
        seq: &SequenceHandle,
        token: i64,
        conf: f32,
    ) -> Result<SequenceHandle>;

    /// Get the token ids and the confidence associated with each token.
    fn get_tokens(&self, seq: &SequenceHandle) -> Result<TokenSequence>;

    /// Get the decoder heads used for alignment calculation with dtw. This only works directly after passing
    /// a sequence handle to forward() and the next call to forward() may overwrite the result.
    /// the result has the shape [heads, tokens, encoder_frames]
    fn get_alignment_data(&self, seq: &SequenceHandle) -> Result<AlignmentData>;

    /// Run a single forward pass of the decoder.
    /// Returns the probabilities for the next token with shape [batch_size, 51866]
    fn forward(&mut self, inputs: &[(AudioChunkHandle, SequenceHandle)]) -> Result<Array2<f32>>;

    fn name(&self) -> String;
}
