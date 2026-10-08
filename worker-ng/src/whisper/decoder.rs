use crate::{
    model_downloader::RemoteModel,
    whisper::{
        decoder_loop::{Atom, TokenProbs, WhisperDecoderBackend},
        timing::AlignmentData,
        tokenizer::Tokenizer,
    },
};
use anyhow::{Context, Result};
use ndarray::{Array2, Array3, s};
use ort::{
    session::{Session, builder::GraphOptimizationLevel},
    value::{DynValueTypeMarker, Tensor},
};
use std::hash::Hash;
use std::{collections::HashMap, fmt::Debug, sync::Arc};

pub const WHISPER_V3_LARGE_DECODER: RemoteModel = RemoteModel {
    url: "https://huggingface.co/onnx-community/whisper-large-v3-turbo_timestamped/resolve/main/onnx/decoder_model_merged_fp16.onnx",
    name: "whisper-large-v3-turbo-decoder.onnx",
    size: 344288457,
};
pub const ALIGNMENT_HEADS: [(usize, usize); 6] =
    [(2, 4), (2, 11), (3, 3), (3, 6), (3, 11), (3, 14)];

pub struct WhisperDecoderOrt {
    model: Session,
    tokenizer: Tokenizer,
    kv_cache_key: Vec<(UniqueKey, UniqueKey)>,
    kv_cache: KvCache,
}
impl WhisperDecoderBackend<WhisperDecoderOrtAudioChunkHandle, WhisperDecoderOrtSequenceHandle>
    for WhisperDecoderOrt
{
    async fn register_encoded_audio_chunk(
        &mut self,
        chunk: Array2<f32>,
    ) -> WhisperDecoderOrtAudioChunkHandle {
        WhisperDecoderOrtAudioChunkHandle {
            data: chunk,
            kv_cache_key: UniqueKey::new(),
        }
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

    async fn token_sequence_to_atoms(
        &self,
        seq: &WhisperDecoderOrtSequenceHandle,
        audio_chunk: &WhisperDecoderOrtAudioChunkHandle,
    ) -> Result<Vec<Atom>> {
        let audio_chunk_len = audio_chunk.data.shape()[0];
        let alignment = seq.alignment_data.calculate_alignment(audio_chunk_len)?;
        let mut to_return = Vec::new();

        let mut start = 0.0;
        for (end_timestamp, &(conf, token)) in alignment.iter().zip(&seq.tokens) {
            let end = *end_timestamp as f32 / 1500.0 * 30.0;
            // TODO: deal with conf and timestamp conf
            to_return.push(Atom {
                conf,
                conf_ts: 1.0,
                start,
                end,
                text: self.tokenizer.decode(&[token])?,
            });
            start = end;
        }

        Ok(to_return)
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

        let mut ort_inputs: Vec<(
            std::borrow::Cow<'_, str>,
            ort::session::SessionInputValue<'_>,
        )> = ort::inputs![
            "encoder_hidden_states" => self.audio_chunks_as_tensor(inputs.iter().map(|(audio, _)| audio))?,
            "input_ids" => self.sequences_as_tensor(inputs.iter().map(|(_, seq)| seq), cache_hit)?,
            "use_cache_branch" => Tensor::from_array(([1], vec![cache_hit]))?,
        ];

        if cache_keys == self.kv_cache_key {
            self.kv_cache.add_self_to_ort_inputs(&mut ort_inputs)?;
        } else {
            for i in 0..4 {
                for name in [
                    "decoder.key",
                    "decoder.value",
                    "encoder.key",
                    "encoder.value",
                ] {
                    ort_inputs.push((
                        format!("past_key_values.{i}.{name}").into(),
                        Tensor::from_array(([0, 20, 0, 64], vec![0.0f32; 0]))
                            .unwrap()
                            .into(),
                    ));
                }
            }
        }

        let outputs: ort::session::SessionOutputs<'_> = self
            .model
            .run(ort_inputs)
            .context("running the decoder onnx model failed")?;

        let logits = outputs["logits"].try_extract_array::<f32>().unwrap();
        let seq_len = logits.shape()[1];
        let mut result = Vec::new();
        for b in 0..batch_size {
            let token_probs = TokenProbs {
                logits: logits.slice(s![b, seq_len - 1, ..]).to_vec(),
            };

            let mut seq = inputs[b].1.clone();
            seq.alignment_data
                .add_cross_attention_weights(&outputs, b)?;
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
        let model_path = WHISPER_V3_LARGE_DECODER
            .ensure_downloaded(|_done, _total| {})
            .await?;
        let model = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap()
            .commit_from_file(model_path)?;
        let tokenizer = Tokenizer::new().await?;

        Ok(Self {
            tokenizer,
            model,
            kv_cache: KvCache::default(),
            kv_cache_key: Vec::new(),
        })
    }

    fn audio_chunks_as_tensor<'a>(
        &self,
        audio_chunk: impl ExactSizeIterator<Item = &'a WhisperDecoderOrtAudioChunkHandle>,
    ) -> Result<Tensor<f32>> {
        let batch_size = audio_chunk.len();
        let mut audio_chunk = audio_chunk.peekable();
        let features = audio_chunk.peek().unwrap().data.shape()[0];
        let frames = audio_chunk.peek().unwrap().data.shape()[1];
        let mut combined_array = Array3::zeros((batch_size, features, frames));
        for (b, chunk) in audio_chunk.enumerate() {
            assert_eq!(features, chunk.data.shape()[0]);
            assert_eq!(frames, chunk.data.shape()[1]);
            combined_array.slice_mut(s![b, .., ..]).assign(&chunk.data);
        }
        Ok(Tensor::from_array(combined_array)?)
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

#[derive(Clone, Debug)]
pub struct WhisperDecoderOrtAudioChunkHandle {
    data: Array2<f32>,
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
    pub fn add_self_to_ort_inputs(
        &self,
        ort_inputs: &mut Vec<(
            std::borrow::Cow<'_, str>,
            ort::session::SessionInputValue<'_>,
        )>,
    ) -> Result<()> {
        for (k, v) in self.data.iter() {
            ort_inputs.push((format!("past_key_values.{k}").into(), v.clone().into()));
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
