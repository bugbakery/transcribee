use super::encoder::WhisperEncoderOrt;
use crate::{model_downloader::RemoteModel, whisper::tokenizer::Tokenizer};
use anyhow::{Context, Result};
use compute::functions::softmax;
use ndarray::{Array2, Array3, ArrayD};
use ort::{
    session::{Session, builder::GraphOptimizationLevel},
    value::{Tensor, Value},
};
use std::{collections::HashMap, default, time::Instant};

pub const WHISPER_V3_LARGE_DECODER: RemoteModel = RemoteModel {
    url: "https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/onnx/decoder_model_merged_fp16.onnx",
    name: "whisper-large-v3-turbo-decoder.onnx",
    size: 344227339,
};

pub struct WhisperDecoderOrt {
    encoder: WhisperEncoderOrt,
    model: Session,
    tokenizer: Tokenizer,
}

impl WhisperDecoderOrt {
    pub async fn new(encoder: WhisperEncoderOrt) -> Result<Self> {
        let model_path = WHISPER_V3_LARGE_DECODER
            .ensure_downloaded(|_done, _total| {})
            .await?;
        let model = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap()
            .commit_from_file(model_path)?;
        let tokenizer = Tokenizer::new().await?;

        Ok(Self {
            encoder,
            tokenizer,
            model,
        })
    }

    pub fn run_onnx_model(
        &mut self,
        encoded: Array3<f32>,
        input_ids: Array2<i64>,
        kv_cache: &mut KvCache,
    ) -> Result<ArrayD<f32>> {
        let start = Instant::now();

        let input_seq_len = input_ids.shape()[1];
        let encoded_seq_len = encoded.shape()[1];
        assert_eq!(encoded_seq_len, 1500);

        let mut inputs = ort::inputs![
            "input_ids" => Tensor::from_array(input_ids)?,
            "encoder_hidden_states" => Tensor::from_array(encoded)?,
        ];
        kv_cache.add_self_to_ort_inputs(input_seq_len, &mut inputs)?;

        let outputs: ort::session::SessionOutputs<'_> = self
            .model
            .run(inputs)
            .context("running the decoder onnx model failed")?;
        let (shape, data) = outputs["logits"].try_extract_tensor::<f32>().unwrap();
        let logits = ArrayD::from_shape_vec(
            shape.iter().map(|x| *x as usize).collect::<Vec<_>>(),
            data.to_vec(),
        )?;

        kv_cache.update_from_session_outputs(outputs);

        let duration = start.elapsed();
        println!("forward pass of decoder took {}s", duration.as_secs_f32());
        Ok(logits)
    }

    pub async fn detect_language(&mut self) -> Result<Vec<(&str, f64)>> {
        let encoded = self.encoder.get(0..self.encoder.len().min(16_000 * 30))?;

        let input_ids =
            Array2::<i64>::from_shape_vec((1, 1), vec![self.tokenizer.startoftranscript()])
                .unwrap();

        let logits = self.run_onnx_model(encoded, input_ids, &mut KvCache::default())?;

        let batch = logits.outer_iter().next().unwrap();
        let token = batch.outer_iter().next().unwrap();
        let (languages, logits): (Vec<&str>, Vec<f64>) = token
            .iter()
            .enumerate()
            .filter_map(|(i, logit)| {
                self.tokenizer
                    .decode_language(i as i64)
                    .map(|lang| (lang, *logit as f64))
            })
            .collect();

        let probs = softmax(&logits);
        let mut result: Vec<_> = languages.into_iter().zip(probs).collect();
        result.sort_by(|(_, x), (_, y)| y.total_cmp(x));
        Ok(result)
    }

    pub async fn transcribe(&mut self, lang: &str) -> Result<()> {
        let encoded = self.encoder.get(0..self.encoder.len().min(16_000 * 30))?;

        let kv_cache = &mut KvCache::default();
        let mut sequence = vec![];
        // sequence.push(self.tokenizer.startofprev());
        // sequence.append(&mut self.tokenizer.encode(" transcribee.")?);
        sequence.append(&mut self.tokenizer.sot_sequence("en")?);
        loop {
            let input_ids = if matches!(kv_cache, KvCache::Empty) {
                Array2::<i64>::from_shape_vec((1, sequence.len()), sequence.clone())?
            } else {
                Array2::from_shape_vec((1, 1), vec![*sequence.last().unwrap()])?
            };

            let logits = self.run_onnx_model(encoded.clone(), input_ids, kv_cache)?;

            let batch = logits.outer_iter().next().unwrap();
            let greedy_decoded: Vec<_> = batch
                .outer_iter()
                .map(|logits| {
                    logits
                        .iter()
                        .enumerate()
                        .max_by(|(_, x), (_, y)| x.total_cmp(y))
                        .unwrap()
                        .0 as i64
                })
                .collect();
            let best = *greedy_decoded.last().unwrap();
            sequence.push(best);
            let sequence_decoded = self.tokenizer.decode(&sequence)?;
            println!("seq: {sequence_decoded}");
            if best == self.tokenizer.endoftext() {
                break;
            }
        }

        Ok(())
    }
}

pub enum KvCache {
    Empty,
    Full(HashMap<String, Value>),
}
impl Default for KvCache {
    fn default() -> Self {
        Self::Empty
    }
}
impl KvCache {
    pub fn add_self_to_ort_inputs(
        &self,
        decoder_seq_len: usize,
        ort_inputs: &mut Vec<(
            std::borrow::Cow<'_, str>,
            ort::session::SessionInputValue<'_>,
        )>,
    ) -> Result<()> {
        match self {
            KvCache::Empty => {
                ort_inputs.push((
                    "use_cache_branch".into(),
                    Tensor::from_array(([1], vec![false]))?.into(),
                ));
                for i in 0..4 {
                    for name in [
                        "decoder.key",
                        "decoder.value",
                        "encoder.key",
                        "encoder.value",
                    ] {
                        ort_inputs.push((
                            format!("past_key_values.{i}.{name}").into(),
                            Tensor::from_array(([0, 20, 0, 64], vec![0.0f32; 0])).unwrap().into(),
                        ));
                    }
                }
            }
            KvCache::Full(enties) => {
                ort_inputs.push((
                    "use_cache_branch".into(),
                    Tensor::from_array(([1], vec![true]))?.into(),
                ));
                for (k, v) in enties.iter() {
                    ort_inputs.push((format!("past_key_values.{k}").into(), v.clone().into()));
                }
            }
        }
        Ok(())
    }

    pub fn update_from_session_outputs(&mut self, outputs: ort::session::SessionOutputs<'_>) {
        if matches!(self, KvCache::Empty) {
            *self = KvCache::Full(HashMap::new());
        }
        let KvCache::Full(map) = self else {
            unreachable!()
        };
        for (name, v) in outputs.iter() {
            if let Some(name) = name.strip_prefix("present.") {
                let new_len = v
                    .shape()
                    .into_iter()
                    .cloned()
                    .reduce(|acc, e| acc * e)
                    .unwrap();
                if new_len != 0 {
                    // the encoder kv entries are only produced in the first run
                    map.insert(name.to_string(), v.clone());
                }
            }
        }
    }

    fn zero_tensor(shape: &[usize]) -> Tensor<f32> {
        Tensor::from_array((
            shape,
            vec![0.0; shape.into_iter().cloned().reduce(|acc, e| acc * e).unwrap()],
        ))
        .unwrap()
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::audio_reader::AudioReader;

    #[tokio::test]
    async fn test_detect_language() {
        let ar = AudioReader::new("../worker/tests/data/sample.mp3").unwrap();
        let encoder = WhisperEncoderOrt::new(ar).await.unwrap();
        let mut decoder = WhisperDecoderOrt::new(encoder).await.unwrap();
        let langs = decoder.detect_language().await.unwrap();
        let (top_lang, prob) = langs[0];
        assert_eq!(top_lang, "en");
        assert!(prob > 0.99);
    }

    #[tokio::test]
    async fn test_transcribe() {
        let ar = AudioReader::new("../worker/tests/data/sample.mp3")
            .unwrap();
        let encoder = WhisperEncoderOrt::new(ar).await.unwrap();
        let mut decoder = WhisperDecoderOrt::new(encoder).await.unwrap();
        let langs = decoder.transcribe("en").await.unwrap();
    }
}
