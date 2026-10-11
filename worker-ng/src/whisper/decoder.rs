use crate::whisper::{
    decoder_loop::{TokenProbs, WhisperDecoderBackend},
    timing::AlignmentData,
};
use anyhow::{Context, Result};
use half::f16;
use ndarray::{Array1, Array2, Array3, Array4, s};
use ort::{
    MINOR_VERSION, ep,
    memory::{AllocationDevice, MemoryInfo},
    session::{IoBinding, Session, builder::GraphOptimizationLevel},
    value::{DynValueTypeMarker, Tensor, Value},
};
use std::{
    collections::HashMap,
    fmt::Debug,
    sync::{Arc, Mutex},
};
use std::{hash::Hash, time::Instant};

pub const ALIGNMENT_HEADS: [(usize, usize); 6] =
    [(2, 4), (2, 11), (3, 3), (3, 6), (3, 11), (3, 14)];

pub struct WhisperDecoderOrt {
    model: Session,
    cross_kv_prefill_model: Session,

    cross_kv_cache: Value<DynValueTypeMarker>,
    registered_audio_chunks: HashMap<UniqueKey, (Array2<f32>, usize)>,

    kv_cache: KvCache,
}
impl WhisperDecoderOrt {
    pub async fn new() -> Result<Self> {
        let model = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap()
            .with_execution_providers([ep::WebGPU::default().build()])
            .unwrap()
            .with_profiling("onnxruntime.profile")
            .unwrap()
            .commit_from_file("src/whisper/whisper_large_v3_turbo_decoder.onnx")?;

        let cross_kv_prefill_model = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap()
            .with_execution_providers([ep::WebGPU::default().build()])
            .unwrap()
            .commit_from_file(
                "src/whisper/whisper_large_v3_turbo_decoder_cross_kv_cache_prefill.onnx",
            )?;

        dbg!(MINOR_VERSION);

        Ok(Self {
            model,
            cross_kv_prefill_model,
            kv_cache: KvCache::default(),
            cross_kv_cache: Tensor::from_array(Array4::<f32>::zeros((0, 8, 1280, 1280)))?
                .into_dyn(),
            registered_audio_chunks: HashMap::new(),
        })
    }

    fn sequences_as_tensor<'a>(
        &self,
        sequences: impl ExactSizeIterator<Item = &'a WhisperDecoderOrtSequenceHandle>,
        only_last_token: bool,
    ) -> Result<Tensor<i64>> {
        let batch_size = sequences.len();
        let mut sequences = sequences.peekable();
        let sequence_len = sequences.peek().unwrap().tokens.len();
        let mut input_ids: Vec<i64> = vec![];
        for seq in sequences {
            assert_eq!(sequence_len, seq.tokens.len());
            if only_last_token {
                input_ids.push(seq.tokens.last().unwrap().1);
            } else {
                for &(_, token) in &seq.tokens {
                    input_ids.push(token);
                }
            }
        }
        let sequence_len = if only_last_token { 1 } else { sequence_len };
        Ok(Tensor::from_array(([batch_size, sequence_len], input_ids))?)
    }
}
impl WhisperDecoderBackend<WhisperDecoderOrtAudioChunkHandle, WhisperDecoderOrtSequenceHandle>
    for WhisperDecoderOrt
{
    async fn register_encoded_audio_chunks(
        &mut self,
        chunks: impl ExactSizeIterator<Item = Array2<f32>>,
    ) -> Result<Vec<WhisperDecoderOrtAudioChunkHandle>> {
        let start = Instant::now();
        let batch_size = self.registered_audio_chunks.len() + chunks.len();
        let mut encoder_hidden_states = Array3::zeros((batch_size, 1500, 1280));
        let mut i = 0;
        for (data, index) in self.registered_audio_chunks.values_mut() {
            encoder_hidden_states.slice_mut(s![i, .., ..]).assign(data);
            *index = i;
            i += 1;
        }
        let mut new_handles = Vec::new();
        for data in chunks {
            encoder_hidden_states.slice_mut(s![i, .., ..]).assign(&data);
            let handle = WhisperDecoderOrtAudioChunkHandle {
                on_destroy: Arc::new(Mutex::new(Some(Box::new(|_| {})))),
                kv_cache_key: UniqueKey::new(),
            };
            self.registered_audio_chunks
                .insert(handle.kv_cache_key.clone(), (data, i));
            new_handles.push(handle);
            i += 1;
        }

        let mut binding = self.cross_kv_prefill_model.create_binding()?;
        binding.bind_input(
            "encoder_hidden_states",
            &Tensor::from_array(encoder_hidden_states)?,
        )?;
        let memory_info = MemoryInfo::new(
            AllocationDevice::WEBGPU_BUFFER,
            0,
            ort::memory::AllocatorType::Device,
            ort::memory::MemoryType::CPUOutput,
        )?;
        binding.bind_output_to_device("cross_kv_cache", &memory_info)?;

        let mut outputs = self
            .cross_kv_prefill_model
            .run_binding(&binding)
            .context("running the cross_kv_prefill_model onnx model failed")?;

        self.cross_kv_cache = outputs.remove("cross_kv_cache").unwrap();
        dbg!(self.cross_kv_cache.shape());
        println!("register_encoded_audio_chunks took {:?}", start.elapsed());
        Ok(new_handles)
    }

    async fn register_sequence(&mut self, tokens: &[i64]) -> WhisperDecoderOrtSequenceHandle {
        WhisperDecoderOrtSequenceHandle {
            tokens: tokens.iter().map(|token| (1.0, *token)).collect(),
            kv_cache_key: UniqueKey::new(),
            alignment_data: AlignmentData::default(),
        }
    }

    // TODO: the implementation of this is currently unsound if we append more than one token
    // (the kv cache is just silently wrong)
    async fn append_token_to_sequence(
        &mut self,
        seq: &WhisperDecoderOrtSequenceHandle,
        conf: f32,
        token: i64,
    ) -> WhisperDecoderOrtSequenceHandle {
        let mut to_return = seq.clone();
        to_return.tokens.push((conf, token));
        to_return
    }

    fn seq_conf(&self, seq: &WhisperDecoderOrtSequenceHandle) -> f64 {
        seq.tokens
            .iter()
            .map(|(conf, _)| *conf as f64)
            .reduce(|acc, x| acc * x)
            .unwrap_or(1.0)
    }

    fn get_tokens(&self, seq: &WhisperDecoderOrtSequenceHandle) -> Result<Vec<(f32, i64)>> {
        Ok(seq.tokens.clone())
    }

    async fn forward(
        &mut self,
        inputs: &[(
            WhisperDecoderOrtAudioChunkHandle,
            WhisperDecoderOrtSequenceHandle,
        )],
    ) -> Result<Vec<(WhisperDecoderOrtSequenceHandle, TokenProbs)>> {
        let batch_size = inputs.len();

        let mut cross_kv_cache_indices = Array1::<i64>::zeros(inputs.len());
        for i in 0..inputs.len() {
            let (_, idx) = self.registered_audio_chunks[&inputs[i].0.kv_cache_key];
            cross_kv_cache_indices[i] = idx as i64;
        }

        let is_prefill = self.kv_cache.len() == 0;

        let mut binding = self.model.create_binding()?;
        binding.bind_input(
            "input_ids",
            &self.sequences_as_tensor(inputs.iter().map(|(_, seq)| seq), !is_prefill)?,
        )?;
        binding.bind_input("cross_kv_cache", &self.cross_kv_cache)?;
        binding.bind_input(
            "cross_kv_cache_indices",
            &Tensor::from_array(cross_kv_cache_indices)?,
        )?;
        binding.bind_output_to_device("logits", &self.model.allocator().memory_info())?;

        if is_prefill {
            for i in 0..4 {
                for name in [
                    format!("block.{i}.attn.key"),
                    format!("block.{i}.attn.value"),
                ] {
                    binding.bind_input(
                        format!("past.{name}"),
                        &Tensor::<f16>::new(self.model.allocator(), [0usize, 20, 0, 64])?,
                    )?;
                    binding.bind_output_to_device(
                        format!("present.{name}"),
                        &self.model.allocator().memory_info(),
                    )?;
                }
            }
            binding.bind_input(
                "self_kv_cache_lengths",
                &Tensor::from_array(Array1::from_vec(vec![0i64]))?,
            )?;
            binding.bind_input(
                "self_kv_cache_indices",
                &Tensor::from_array(Array1::from_vec(vec![0i64]))?,
            )?;
        } else {
            let seq_unique_keyes: Vec<UniqueKey> = inputs
                .iter()
                .map(|(_, seq)| seq.kv_cache_key.clone())
                .collect();
            self.kv_cache
                .add_self_to_ort_binding(&mut binding, &self.model, seq_unique_keyes)?;
        }

        let start = Instant::now();
        let mut outputs: ort::session::SessionOutputs<'_> = self
            .model
            .run_binding(&binding)
            .context("running the decoder onnx model failed")?;
        println!("forward pass: {:?}", start.elapsed());

        let logits = outputs["logits"].try_extract_array::<f32>().unwrap();
        let seq_len = logits.shape()[1];
        let mut result = Vec::new();
        for b in 0..batch_size {
            let token_probs = TokenProbs {
                logits: logits.slice(s![b, seq_len - 1, ..]).to_vec(),
            };

            let mut seq = inputs[b].1.clone();
            // seq.alignment_data
            //     .add_cross_attention_weights(&outputs, b)?;
            seq.kv_cache_key = UniqueKey::new();

            result.push((seq, token_probs));
        }

        // manage kv cache
        let seq_keys: Vec<UniqueKey> = result
            .iter()
            .map(|(handle, _)| handle.kv_cache_key.clone())
            .collect();
        let lengths: Vec<i64> = result
            .iter()
            .map(|(handle, _)| handle.tokens.len() as i64)
            .collect();
        self.kv_cache
            .update_from_session_outputs(&mut outputs, seq_keys, lengths);

        Ok(result)
    }
}

// TODO: this is a memory leak atm. Think about it and sprinkle some weakref
#[derive(Clone)]
pub struct WhisperDecoderOrtAudioChunkHandle {
    on_destroy: Arc<Mutex<Option<Box<dyn FnMut(UniqueKey)>>>>,
    kv_cache_key: UniqueKey,
}

#[derive(Clone, Debug)]
pub struct WhisperDecoderOrtSequenceHandle {
    tokens: Vec<(f32, i64)>, // (probability, token)
    kv_cache_key: UniqueKey,
    alignment_data: AlignmentData,
}
impl Hash for WhisperDecoderOrtSequenceHandle {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.kv_cache_key.hash(state);
    }
}
impl PartialEq for WhisperDecoderOrtSequenceHandle {
    fn eq(&self, other: &Self) -> bool {
        self.kv_cache_key == other.kv_cache_key
    }
}
impl Eq for WhisperDecoderOrtSequenceHandle {}

#[derive(Clone)]
pub struct UniqueKey(Arc<()>);
impl UniqueKey {
    pub fn new() -> Self {
        Self(Arc::new(()))
    }
}
impl PartialEq for UniqueKey {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}
impl Eq for UniqueKey {}
impl Debug for UniqueKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_fmt(format_args!(
            "KVCacheKey({:X})",
            self.0.as_ref() as *const _ as usize
        ))
    }
}
impl Hash for UniqueKey {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        (self.0.as_ref() as *const _ as usize).hash(state);
    }
}

/// Our KV caching mechanism. Our model can do a gather on the first axis (batches) for the KV cache
/// to efficiently support beam search (sharing audio and duplicating/moving past self KV cache entries).
#[derive(Default)]
pub struct KvCache {
    /// the tensors that make up this kv cache. Dims [batch, ... (dont care)]
    tensors: HashMap<String, ort::value::Value<DynValueTypeMarker>>,
    /// map of index in the first (batch) dimension to handle
    handles: Vec<UniqueKey>,
    // the length of the kv cache entries
    lengths: Vec<i64>,
}
impl KvCache {
    pub fn len(&self) -> usize {
        self.handles.len()
    }

    pub fn add_self_to_ort_binding(
        &self,
        binding: &mut IoBinding,
        model: &Session,
        handles: Vec<UniqueKey>,
    ) -> Result<()> {
        let memory_info = MemoryInfo::new(
            AllocationDevice::WEBGPU_BUFFER,
            0,
            ort::memory::AllocatorType::Device,
            ort::memory::MemoryType::CPUOutput,
        )?;
        for (k, v) in self.tensors.iter() {
            binding.bind_input(format!("past.{k}"), v)?;
            binding.bind_output_to_device(format!("present.{k}"), &memory_info)?;
        }
        let input_map = Array1::from_iter(self.get_input_map(&handles));
        binding.bind_input("self_kv_cache_indices", &Tensor::from_array(input_map)?)?;
        let cache_lengths = Array1::from_vec(self.lengths.clone());
        binding.bind_input("self_kv_cache_lengths", &Tensor::from_array(cache_lengths)?)?;

        Ok(())
    }

    fn get_input_map(&self, handles: &[UniqueKey]) -> impl Iterator<Item = i64> {
        return handles.iter().map(|handle| {
            self.handles
                .iter()
                .position(|candidate| candidate == handle)
                .unwrap() as i64
        });
    }

    pub fn update_from_session_outputs(
        &mut self,
        outputs: &mut ort::session::SessionOutputs<'_>,
        handles: Vec<UniqueKey>,
        lengths: Vec<i64>,
    ) {
        let names: Vec<&str> = outputs.keys().collect();
        for name in names {
            if let Some(stripped) = name.strip_prefix("present.") {
                self.tensors
                    .insert(stripped.to_string(), outputs.remove(name).unwrap());
            }
        }
        self.handles = handles;
        self.lengths = lengths;
    }
}
