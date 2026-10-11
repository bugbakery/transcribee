use crate::whisper::{
    decoder_loop::{TokenProbs, WhisperDecoderBackend},
    timing::AlignmentData,
};
use anyhow::{Context, Result};
use half::f16;
use ndarray::{Array1, Array2, Array3, Array4, s};
use ort::{
    ep,
    session::{Session, builder::GraphOptimizationLevel},
    value::{DynValueTypeMarker, Tensor, TensorElementType, Value},
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

    kv_cache_key: Vec<(UniqueKey, UniqueKey)>,
    kv_cache: KvCache,
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
        binding.bind_output_to_device(
            "cross_kv_cache",
            &self.cross_kv_prefill_model.allocator().memory_info(),
        )?;

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

        // add existing kv_cache to model
        // currently we just do this if the current invocation requires exactly the stuff in the cache
        // TODO: add reshaping here so that we can also deal with partial hits
        let cache_keys: Vec<_> = inputs
            .iter()
            .map(|(audio, seq)| (audio.kv_cache_key.clone(), seq.kv_cache_key.clone()))
            .collect();
        let cache_hit = cache_keys == self.kv_cache_key;
        dbg!(cache_hit);

        let mut cross_kv_cache_indices = Array1::<i64>::zeros(inputs.len());
        for i in 0..inputs.len() {
            let (_, idx) = self.registered_audio_chunks[&inputs[i].0.kv_cache_key];
            cross_kv_cache_indices[i] = idx as i64;
        }

        dbg!(self.kv_cache.len());
        let mut ort_inputs: Vec<(
            std::borrow::Cow<'_, str>,
            ort::session::SessionInputValue<'_>,
        )> = ort::inputs![
            "input_ids" => self.sequences_as_tensor(inputs.iter().map(|(_, seq)| seq), cache_hit)?,
            "cross_kv_cache" => &self.cross_kv_cache,
            "cross_kv_cache_indices" => Tensor::from_array(cross_kv_cache_indices)?,
            "self_kv_cache_indices" => Tensor::from_array(Array1::from_iter(0..(batch_size as i64)))?,
            "self_kv_cache_lengths" => Tensor::from_array(Array1::from_iter((0..batch_size).map(|i| if cache_hit { self.kv_cache.len() as i64 } else {0})))?,
        ];

        if cache_hit {
            self.kv_cache.add_self_to_ort_inputs(&mut ort_inputs)?;
        } else {
            for i in 0..4 {
                for name in [
                    format!("past.block.{i}.attn.key"),
                    format!("past.block.{i}.attn.value"),
                ] {
                    ort_inputs.push((
                        name.into(),
                        Tensor::<f16>::new(self.model.allocator(), [0usize, 20, 0, 64])
                            .unwrap()
                            .into(),
                    ));
                }
            }
        }

        let start = Instant::now();
        let outputs: ort::session::SessionOutputs<'_> = self
            .model
            .run(ort_inputs)
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
        self.kv_cache.update_from_session_outputs(&outputs);
        self.kv_cache_key = cache_keys
            .iter()
            .enumerate()
            .map(|(i, (audio_key, _))| (audio_key.clone(), result[i].0.kv_cache_key.clone()))
            .collect();

        Ok(result)
    }
}
impl WhisperDecoderOrt {
    pub async fn new() -> Result<Self> {
        let model = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap()
            .with_execution_providers([ep::WebGPU::default().build()])
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

        Ok(Self {
            model,
            cross_kv_prefill_model,
            kv_cache: KvCache::default(),
            kv_cache_key: Vec::new(),
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

#[derive(Default)]
pub struct KvCache {
    data: HashMap<String, ort::value::Value<DynValueTypeMarker>>,
}
impl KvCache {
    pub fn len(&self) -> usize {
        for elem in self.data.values() {
            return elem.shape()[2] as usize;
        }
        0
    }

    pub fn add_self_to_ort_inputs(
        &self,
        ort_inputs: &mut Vec<(
            std::borrow::Cow<'_, str>,
            ort::session::SessionInputValue<'_>,
        )>,
    ) -> Result<()> {
        for (k, v) in self.data.iter() {
            ort_inputs.push((format!("past.{k}").into(), v.clone().into()));
        }
        Ok(())
    }

    pub fn update_from_session_outputs(&mut self, outputs: &ort::session::SessionOutputs<'_>) {
        for (name, v) in outputs.iter() {
            if let Some(name) = name.strip_prefix("present.") {
                let new_len = v.shape().iter().cloned().reduce(|acc, e| acc * e).unwrap();
                if new_len != 0 {
                    // the encoder kv entries are only produced in the first run
                    self.data.insert(name.to_string(), v.clone());
                }
            }
        }
    }
}
