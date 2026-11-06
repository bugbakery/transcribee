//! This file contains an ONNX backed implementation of the decoder backend defined in `../decoder.rs`

use super::ORT_RUNTIME;
use crate::whisper::{
    decoder::{
        AlignmentData, AudioChunkHandle, SequenceHandle, TokenLogits, TokenSequence,
        WhisperDecoderBackend,
    },
    handle::Handle,
};
use anyhow::{Context, Result, bail};
use half::f16;
use log::{debug, info};
use ndarray::{Array1, Array2, Array3, Array4, s};
use ort::{
    ep::ExecutionProviderDispatch,
    memory::{Allocator, MemoryInfo},
    session::{IoBinding, Session, builder::GraphOptimizationLevel},
    value::{DynValueTypeMarker, Tensor, Value},
};
use std::collections::HashMap;
use std::time::Instant;

pub type OrtAudioChunkHandle = Handle;
#[derive(Clone)]
pub struct OrtSequenceHandle {
    tokens: TokenSequence,
    handle: Handle,
    last_handle: Option<Handle>,
}

pub struct WhisperDecoderOrt {
    model: Session,
    cross_kv: CrossKV,
    kv_cache: KvCache,
}
impl WhisperDecoderOrt {
    pub fn new(backend: ExecutionProviderDispatch, model_path: &str) -> Result<Self> {
        let model = Session::builder(&ORT_RUNTIME)?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap()
            .with_execution_providers([backend.clone()])
            .unwrap()
            .commit_from_file(model_path)?;

        let base_path = &model_path
            .trim_end_matches("_decoder.onnx")
            .trim_end_matches("_decoder_onnx_attn.onnx")
            .trim_end_matches("_decoder_ms_attn.onnx");
        Ok(Self {
            model,
            cross_kv: CrossKV::new(
                backend.clone(),
                &format!("{base_path}_decoder_cross_kv_prefill.onnx"),
            )?,
            kv_cache: KvCache::default(),
        })
    }
}

impl WhisperDecoderBackend for WhisperDecoderOrt {
    fn register_encoded_audio_chunks(
        &mut self,
        chunks: &[Array2<f32>],
    ) -> Result<Vec<AudioChunkHandle>> {
        Ok(self
            .cross_kv
            .register_encoded_audio_chunks(chunks)?
            .into_iter()
            .map(AudioChunkHandle::downcast)
            .collect())
    }

    fn register_sequence(&mut self, tokens: &[i64]) -> SequenceHandle {
        SequenceHandle::downcast(OrtSequenceHandle {
            tokens: tokens.iter().map(|token: &i64| (*token, 1.0)).collect(),
            handle: Handle::new(),
            last_handle: None,
        })
    }

    fn append_token_to_sequence(
        &mut self,
        seq: &SequenceHandle,
        token: i64,
        conf: f32,
    ) -> Result<SequenceHandle> {
        let seq = seq.upcast::<OrtSequenceHandle>();
        if self
            .kv_cache
            .get_entry_len(&seq.handle)
            .context("handle is not known and thus not in a state where we can append a token")?
            != seq.tokens.len()
        {
            bail!(
                "append_token_to_sequence() must be called exactly once between calling forward()"
            )
        }
        let mut tokens = seq.tokens.clone();
        tokens.push((token, conf));
        Ok(SequenceHandle::downcast(OrtSequenceHandle {
            tokens,
            handle: Handle::new(),
            last_handle: Some(seq.handle.clone()),
        }))
    }

    fn get_tokens(&self, seq: &SequenceHandle) -> Result<TokenSequence> {
        Ok(seq.upcast::<OrtSequenceHandle>().tokens.clone())
    }

    fn forward(
        &mut self,
        inputs: &[(AudioChunkHandle, SequenceHandle)],
    ) -> Result<(TokenLogits, AlignmentData)> {
        let inputs: Vec<(OrtAudioChunkHandle, OrtSequenceHandle)> = inputs
            .iter()
            .map(|(a, s)| {
                (
                    a.upcast::<OrtAudioChunkHandle>().clone(),
                    s.upcast::<OrtSequenceHandle>().clone(),
                )
            })
            .collect();

        let start_forward_fn: Instant = Instant::now();
        let batch_size = inputs.len();

        let mut binding = self.model.create_binding()?;
        self.cross_kv
            .add_self_to_binding(&mut binding, inputs.iter().map(|(a, _)| a))?;

        let is_prefill = inputs.iter().any(|(_, seq)| {
            seq.last_handle
                .as_ref()
                .and_then(|last_handle| self.kv_cache.get_entry_len(last_handle))
                .is_none()
        });
        if is_prefill {
            KvCache::add_prefill_to_ort_bindings(&mut binding, batch_size)?;

            let max_sequence_len = inputs
                .iter()
                .map(|(_, seq)| seq.tokens.len())
                .max()
                .unwrap();
            let mut input_ids = Array2::zeros((batch_size, max_sequence_len));
            for (b, (_, seq)) in inputs.iter().enumerate() {
                for (i, &(token, _)) in seq.tokens.iter().enumerate() {
                    *input_ids.get_mut((b, i)).unwrap() = token;
                }
            }
            binding.bind_input("input_ids", &Tensor::from_array(input_ids)?)?;

            // the self_attn mask is added (not multiplied) onto the raw logits before the softmax
            // thus negative infinity means masked and 0 is the noop
            let mut self_attn_mask =
                Array4::<f32>::zeros((batch_size, 1, max_sequence_len, max_sequence_len));
            for b in 0..batch_size {
                for i in 0..max_sequence_len {
                    for j in 0..max_sequence_len {
                        *self_attn_mask.get_mut((b, 0, i, j)).unwrap() =
                            if i >= j { 0. } else { f32::NEG_INFINITY };
                    }
                }
            }
            binding.bind_input("self_attn_mask", &Tensor::from_array(self_attn_mask)?)?;
        } else {
            let mut input_ids: Vec<i64> = vec![];
            for (_, seq) in &inputs {
                if self.kv_cache.get_entry_len(seq.last_handle.as_ref().unwrap()).context("seq is not known to the kv cache so it cannot participate in a non-prefill batch")? != seq.tokens.len() - 1 {
                    bail!("seq would need more than one token added. this is unsupported in non-prefill batches");
                }
                let &(token, _) = seq.tokens.last().unwrap();
                input_ids.push(token);
            }
            binding.bind_input(
                "input_ids",
                &Tensor::from_array(([batch_size, 1], input_ids))?,
            )?;

            self.kv_cache.add_self_to_ort_binding(
                &mut binding,
                self.model.allocator().memory_info(),
                inputs.iter().map(|(_, s)| s.last_handle.as_ref().unwrap()),
            )?;

            let max_sequence_len = self.kv_cache.max_sequence_length() + 1;
            let mut self_attn_mask = Array4::<f32>::zeros((batch_size, 1, 1, max_sequence_len));
            for b in 0..batch_size {
                let seq = &inputs[b].1;
                let seq_valid_mask = self
                    .kv_cache
                    .get_entry_validity(seq.last_handle.as_ref().unwrap())
                    .unwrap();
                for j in 0..max_sequence_len {
                    *self_attn_mask.get_mut((b, 0, 0, j)).unwrap() =
                        if *seq_valid_mask.get(j).unwrap_or(&true) {
                            0.
                        } else {
                            f32::NEG_INFINITY
                        };
                }
            }
            binding.bind_input("self_attn_mask", &Tensor::from_array(self_attn_mask)?)?;
        }

        let output_mem_info = self.model.allocator().memory_info();
        binding.bind_output_to_device("logits", output_mem_info)?;
        binding.bind_output_to_device("alignment_heads", output_mem_info)?;

        let start_forward: Instant = Instant::now();
        let mut outputs: ort::session::SessionOutputs<'_> = self
            .model
            .run_binding(&binding)
            .context("running the decoder onnx model failed")?;

        let logits = outputs["logits"].try_extract_array::<f32>()?; // [batch_size, seq_len, 51866]
        let logits = logits.into_dimensionality().unwrap().into_owned();
        let alignment_heads = outputs["alignment_heads"].try_extract_array::<f32>()?; // [batch_size, 6, seq_len, 1280]
        let alignment_heads = alignment_heads.into_dimensionality().unwrap().into_owned();

        debug!(
            "decoder forward pass (b={}, s={}) took {:?}",
            inputs.len(),
            logits.shape()[1],
            start_forward.elapsed()
        );

        let mut new_kv_meta = Vec::new();
        for (_b, (_, seq)) in inputs.iter().enumerate() {
            let seq_len = if is_prefill { seq.tokens.len() } else { 1 };

            let entry_validity = if is_prefill {
                (0..logits.shape()[1])
                    .map(|i| i < seq_len)
                    .collect::<Vec<bool>>()
            } else {
                let mut last = self
                    .kv_cache
                    .get_entry_validity(seq.last_handle.as_ref().unwrap())
                    .unwrap();
                last.push(true);
                last
            };
            new_kv_meta.push((seq.handle.clone(), entry_validity));
        }

        self.kv_cache
            .update_from_session_outputs(&mut outputs, new_kv_meta);

        debug!("forward fn: {:?}", start_forward_fn.elapsed());
        Ok((logits, alignment_heads))
    }
}

pub struct CrossKV {
    model: Session,
    tensors: HashMap<String, Value<DynValueTypeMarker>>,
    registered_audio_chunks: Vec<OrtAudioChunkHandle>,
}
impl CrossKV {
    pub fn new(backend: ExecutionProviderDispatch, model_path: &str) -> Result<Self> {
        let model = Session::builder(&ORT_RUNTIME)?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap()
            .with_execution_providers([backend.clone()])
            .unwrap()
            .commit_from_file(model_path)?;

        let tensors = HashMap::new();
        let registered_audio_chunks = Vec::new();

        Ok(Self {
            model,
            tensors,
            registered_audio_chunks,
        })
    }

    fn register_encoded_audio_chunks(
        &mut self,
        chunks: &[Array2<f32>],
    ) -> Result<Vec<OrtAudioChunkHandle>> {
        let start = Instant::now();
        let batch_size = self.registered_audio_chunks.len() + chunks.len();
        let mut encoder_hidden_states = Array3::zeros((batch_size, 1500, 1280));
        let mut i = 0;
        self.registered_audio_chunks = Vec::new();
        for data in chunks {
            encoder_hidden_states.slice_mut(s![i, .., ..]).assign(data);
            let handle = OrtAudioChunkHandle::new();
            self.registered_audio_chunks.push(handle);
            i += 1;
        }

        let mut binding = self.model.create_binding()?;
        binding.bind_input(
            "encoder_hidden_states",
            &Tensor::from_array(encoder_hidden_states)?,
        )?;
        let output_names: Vec<String> = self
            .model
            .outputs()
            .iter()
            .map(|o| o.name().to_string())
            .collect();
        for output in &output_names {
            binding.bind_output_to_device(output, self.model.allocator().memory_info())?;
        }

        let mut outputs = self
            .model
            .run_binding(&binding)
            .context("running the cross_kv_prefill_model onnx model failed")?;

        self.tensors = output_names
            .iter()
            .map(|output| (output.clone(), outputs.remove(output).unwrap()))
            .collect();

        info!("register_encoded_audio_chunks took {:?}", start.elapsed());
        Ok(self.registered_audio_chunks.clone())
    }

    fn add_self_to_binding<'a>(
        &self,
        binding: &mut IoBinding,
        audio_chunks: impl ExactSizeIterator<Item = &'a OrtAudioChunkHandle>,
    ) -> Result<()> {
        for (name, value) in &self.tensors {
            binding.bind_input(name, value)?;
        }

        let mut cross_kv_cache_indices = Array1::<i64>::zeros(audio_chunks.len());
        for (i, chunk) in audio_chunks.enumerate() {
            let idx = self
                .registered_audio_chunks
                .iter()
                .position(|candidate| candidate == chunk)
                .context(
                    "Could not find requested audio chunk in active set. Please register it first!",
                )?;
            cross_kv_cache_indices[i] = idx as i64;
        }
        binding.bind_input(
            "cross_kv_cache_indices",
            &Tensor::from_array(cross_kv_cache_indices)?,
        )?;

        Ok(())
    }
}

/// Our KV caching mechanism. Our model can do a gather on the first axis (batches) for the KV cache
/// to efficiently support beam search (sharing audio and duplicating/moving past self KV cache entries).
#[derive(Default)]
pub struct KvCache {
    /// the tensors that make up this kv cache. Dims [batch, ... (dont care)]
    tensors: HashMap<String, ort::value::Value<DynValueTypeMarker>>,

    /// map of index in the first (batch) dimension to handle
    /// the second part of the tuple is a vec of bool wether a certain position in the cache is valid or garbage
    handles: Vec<(Handle, Vec<bool>)>,
}
impl KvCache {
    pub fn max_sequence_length(&self) -> usize {
        let tensor = self.tensors.values().next().unwrap();
        tensor.shape()[1] as usize
    }
    fn get_row(&self, handle: &Handle) -> Option<&(Handle, Vec<bool>)> {
        self.handles.iter().find(|x| &x.0 == handle)
    }
    pub fn get_entry_validity(&self, handle: &Handle) -> Option<Vec<bool>> {
        self.get_row(handle).map(|row| row.1.clone())
    }
    pub fn get_entry_len(&self, handle: &Handle) -> Option<usize> {
        self.get_entry_validity(handle)
            .map(|v| v.iter().map(|&x| x as usize).sum())
    }

    fn get_input_map<'a>(
        &self,
        last_handles: impl Iterator<Item = &'a Handle>,
    ) -> impl Iterator<Item = i64> {
        last_handles.map(|handle| {
            self.handles
                .iter()
                .position(|row| &row.0 == handle)
                .unwrap() as i64
        })
    }

    pub fn add_prefill_to_ort_bindings(binding: &mut IoBinding, batch_size: usize) -> Result<()> {
        let memory_info = MemoryInfo::default();
        for i in 0..4 {
            for name in [
                format!("block.{i}.attn.key"),
                format!("block.{i}.attn.value"),
            ] {
                binding.bind_input(
                    format!("past.{name}"),
                    &Tensor::<f16>::new(&Allocator::default(), [1usize, 0, 1280])?,
                )?;
                binding.bind_output_to_device(format!("present.{name}"), &memory_info)?;
            }
        }
        binding.bind_input(
            "self_kv_cache_lengths",
            &Tensor::from_array(Array1::from_vec(vec![0i64; batch_size]))?,
        )?;
        binding.bind_input(
            "self_kv_cache_indices",
            &Tensor::from_array(Array1::from_vec(vec![0i64; batch_size]))?,
        )?;

        Ok(())
    }

    pub fn add_self_to_ort_binding<'a>(
        &self,
        binding: &mut IoBinding,
        memory_info: &MemoryInfo,
        last_handles: impl Iterator<Item = &'a Handle>,
    ) -> Result<()> {
        for (k, v) in self.tensors.iter() {
            binding.bind_input(format!("past.{k}"), v)?;
            binding.bind_output_to_device(format!("present.{k}"), memory_info)?;
        }
        let input_map = Array1::from_iter(self.get_input_map(last_handles));
        binding.bind_input("self_kv_cache_indices", &Tensor::from_array(input_map)?)?;

        let cache_lengths = Array1::from_iter(
            self.handles
                .iter()
                .map(|(handle, _)| self.get_entry_len(handle).unwrap() as i64),
        );
        binding.bind_input("self_kv_cache_lengths", &Tensor::from_array(cache_lengths)?)?;

        Ok(())
    }

    pub fn update_from_session_outputs(
        &mut self,
        outputs: &mut ort::session::SessionOutputs<'_>,
        new: Vec<(Handle, Vec<bool>)>,
    ) {
        let names: Vec<&str> = outputs.keys().collect();
        for name in names {
            if let Some(stripped) = name.strip_prefix("present.") {
                self.tensors
                    .insert(stripped.to_string(), outputs.remove(name).unwrap());
            }
        }
        self.handles = new;
    }
}
