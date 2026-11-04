//! This file contains the Interface description of whisper decoder backends.
//! A backend handles all the number crunching, kv-cache management but none of the actual decoding
//! logic. This makes it possible to (potentially) write different backends for the performance)
//! sensitive part while keeping complexity in check.

use anyhow::Result;
use ndarray::{Array2, Array3};
use std::{any::Any, sync::Arc};

pub type TokenSequence = Vec<(i64, f32)>; // token, conf
pub type AlignmentData = Array3<f32>; // [heads, tokens, encoder_frames]
pub type DynWhisperDecoderBackend = Box<dyn WhisperDecoderBackend>;

pub fn get_backends(
    _model_folder: &str,
) -> Vec<(&str, Box<dyn Fn() -> Result<DynWhisperDecoderBackend>>)> {
    macro_rules! b {
        ($name:expr, $init:expr) => {
            ($name, Box::new(|| ($init).map(|b| Box::new(b) as _)))
        };
    }

    #[rustfmt::skip]
    let backends: Vec<(&str, Box<dyn Fn() -> Result<DynWhisperDecoderBackend>>)> = vec![
        #[cfg(feature = "backend-onnxruntime")]
        b!("ONNX Runtime WebGPU diy attn", crate::backends::onnx::whisper_decoder::WhisperDecoderOrt::new(ort::ep::WebGPU::default().build(), "./target/whisper_large_v3_turbo_decoder.onnx")),

        #[cfg(feature = "backend-onnxruntime")]
        b!("ONNX Runtime CPU diy attn", crate::backends::onnx::whisper_decoder::WhisperDecoderOrt::new(ort::ep::CPU::default().build(), "./target/whisper_large_v3_turbo_decoder.onnx")),
    ];
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
    /// Returns the probabilities for the next token with shape [batch_size, new_tokens, 51866]
    fn forward(&mut self, inputs: &[(AudioChunkHandle, SequenceHandle)]) -> Result<Array3<f32>>;
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::whisper::{
        math::softmax,
        reference::{get_reference_data, is_similiar_to_reference},
    };
    use ndarray::{Axis, concatenate, s};

    fn prefill_works(name: &str, backend: &mut DynWhisperDecoderBackend) -> bool {
        let encoded: Array2<f32> = get_reference_data("encoded.npy")
            .unwrap()
            .into_dimensionality()
            .unwrap();
        let audio_chunk = backend
            .register_encoded_audio_chunks(&[encoded.clone()])
            .unwrap()
            .remove(0);
        let tokens: Vec<i64> = get_reference_data("tokens.npy")
            .unwrap()
            .into_iter()
            .map(|t| t as i64)
            .collect();
        let sequence = backend.register_sequence(&tokens);
        let logits = backend
            .forward(&[(audio_chunk.clone(), sequence.clone())])
            .unwrap();
        let logits = logits
            .slice(s![0, 0..logits.shape()[1] - 1, ..])
            .into_dyn()
            .into_owned();

        let mut is_similiar = true;

        is_similiar &= is_similiar_to_reference(
            "logits.npy",
            &format!("prefill_{name}"),
            softmax(logits, Axis(1)),
            0.1,
        );

        let alignment_weights = backend.get_alignment_data(&sequence).unwrap();
        is_similiar &= is_similiar_to_reference(
            "alignment_weights.npy",
            &format!("prefill_{name}"),
            softmax(alignment_weights.into_dyn(), Axis(2)),
            0.05,
        );

        is_similiar
    }

    fn decode_works(name: &str, backend: &mut DynWhisperDecoderBackend) -> bool {
        let encoded: Array2<f32> = get_reference_data("encoded.npy")
            .unwrap()
            .into_dimensionality()
            .unwrap();
        let audio_chunk = backend
            .register_encoded_audio_chunks(&[encoded.clone()])
            .unwrap()
            .remove(0);
        let tokens: Vec<i64> = get_reference_data("tokens.npy")
            .unwrap()
            .into_iter()
            .map(|t| t as i64)
            .collect();
        let mut sequence = None;
        let mut results = Vec::new();
        for &token in &tokens {
            sequence = Some(if let Some(seq) = &sequence {
                backend.append_token_to_sequence(&seq, token, 1.0).unwrap()
            } else {
                backend.register_sequence(&[token])
            });
            let result = backend
                .forward(&[(audio_chunk.clone(), sequence.as_ref().unwrap().clone())])
                .unwrap();
            results.push(result);
        }
        results.pop();

        let mut is_similiar = true;

        let logits = concatenate(
            Axis(1),
            &results.iter().map(|x| x.view()).collect::<Vec<_>>(),
        )
        .unwrap()
        .slice(s![0, .., ..])
        .into_owned();
        is_similiar &= is_similiar_to_reference(
            "logits.npy",
            &format!("decode_{name}"),
            softmax(logits.into_dyn(), Axis(1)),
            0.1,
        );

        let alignment_weights = backend.get_alignment_data(&sequence.unwrap()).unwrap();
        is_similiar &= is_similiar_to_reference(
            "alignment_weights.npy",
            &format!("decode_{name}"),
            softmax(alignment_weights.into_dyn(), Axis(2)),
            0.05,
        );

        is_similiar
    }

    fn different_length_batches_work(name: &str, backend: &mut DynWhisperDecoderBackend) -> bool {
        let encoded: Array2<f32> = get_reference_data("encoded.npy")
            .unwrap()
            .into_dimensionality()
            .unwrap();
        let audio_chunk = backend
            .register_encoded_audio_chunks(&[encoded.clone()])
            .unwrap()
            .remove(0);
        let reference_tokens: Vec<i64> = get_reference_data("tokens.npy")
            .unwrap()
            .into_iter()
            .map(|t| t as i64)
            .collect();

        let mut sequences = vec![
            backend.register_sequence(&reference_tokens[0..1]),
            backend.register_sequence(&reference_tokens[0..5]),
        ];
        let mut results = vec![vec![]; sequences.len()];
        let mut alignment_weights = vec![None; sequences.len()];
        for round in 0.. {
            let mut input_idx = vec![];
            if round == 0 {
                input_idx.extend_from_slice(&[0, 1]);
            } else {
                for (s_idx, s) in sequences.iter_mut().enumerate() {
                    let sequence_length = backend.get_tokens(s).unwrap().len();
                    if sequence_length < reference_tokens.len() {
                        let token: i64 = reference_tokens[sequence_length];
                        *s = backend
                            .append_token_to_sequence(&s, token as i64, 1.0)
                            .unwrap();
                        input_idx.push(s_idx);
                    }
                }
            }
            if input_idx.is_empty() {
                break;
            }

            let inputs: Vec<_> = input_idx
                .iter()
                .map(|&idx| (audio_chunk.clone(), sequences[idx].clone()))
                .collect();
            let logits = backend.forward(&inputs).unwrap();

            for (i, sequence_idx) in input_idx.into_iter().enumerate() {
                let sequence = &sequences[sequence_idx];
                let sequence_length = backend.get_tokens(sequence).unwrap().len();
                if round == 0 {
                    // we are in prefill and need to check how much of the result we add for each sequence in the batch
                    results[sequence_idx].push(
                        logits
                            .slice(s![i..i + 1, 0..sequence_length, ..])
                            .to_owned(),
                    );
                } else {
                    // we extrude one token at a time and just unconditionally take the only token extruded
                    assert_eq!(logits.shape()[1], 1);
                    results[sequence_idx].push(logits.slice(s![i..i + 1, 0..1, ..]).to_owned());
                }
                alignment_weights[sequence_idx] =
                    Some(backend.get_alignment_data(sequence).unwrap());
            }
        }

        let mut is_similiar = true;

        for i in 0..results.len() {
            let logits = concatenate(
                Axis(1),
                &results[i].iter().map(|x| x.view()).collect::<Vec<_>>(),
            )
            .unwrap()
            .slice(s![0, .., ..])
            .into_owned();
            is_similiar &= is_similiar_to_reference(
                "logits.npy",
                &format!("different_lengh_batches_{i}_{name}"),
                softmax(logits.slice_move(s![0..32, ..]).into_dyn(), Axis(1)),
                0.1,
            );

            is_similiar &= is_similiar_to_reference(
                "alignment_weights.npy",
                &format!("different_lengh_batches_{i}_{name}"),
                softmax(alignment_weights[i].clone().unwrap().into_dyn(), Axis(2)),
                0.05,
            );
        }

        is_similiar
    }

    #[tokio::test]
    async fn test_backends() {
        crate::WHISPER_LARGE_V3_TURBO
            .ensure_downloaded(|_, _| {})
            .await
            .unwrap();

        let mut fail = false;
        for (name, backend) in get_backends("") {
            println!("\ntesting decode backend {name}");
            let mut backend = backend().unwrap();
            fail |= !prefill_works(name, &mut backend);
            fail |= !decode_works(name, &mut backend);
            fail |= !different_length_batches_work(name, &mut backend);
        }
        assert!(!fail);
    }
}
