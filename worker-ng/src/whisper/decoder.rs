use super::encoder::WhisperEncoderOrt;
use crate::{model_downloader::RemoteModel, whisper::tokenizer::Tokenizer};
use anyhow::{Context, Result};
use compute::functions::softmax;
use ndarray::{Array2, Array3, ArrayD, s};
use ort::{
    memory::{AllocationDevice, Allocator, AllocatorType, MemoryInfo, MemoryType},
    session::{Session, builder::GraphOptimizationLevel},
    value::{DynTensor, Tensor, TensorElementType, Value},
};
use std::{collections::HashMap, time::Instant};

// pub const WHISPER_V3_LARGE_DECODER: RemoteModel = RemoteModel {
//     url: "https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/onnx/decoder_model_merged_fp16.onnx",
//     name: "whisper-large-v3-turbo-decoder.onnx",
//     size: 344227339,
// };

// with attention weights for alignment
pub const WHISPER_V3_LARGE_DECODER: RemoteModel = RemoteModel {
    url: "https://huggingface.co/musetric/whisper-large-v3-turbo-onnx/resolve/main/decoder_model_merged_fp16.onnx",
    name: "whisper-large-v3-turbo-decoder.onnx",
    size: 317745737,
};

// with attention weights for alignment
pub const WHISPER_V3_LARGE_DECODER_PREFILL: RemoteModel = RemoteModel {
    url: "https://huggingface.co/musetric/whisper-large-v3-turbo-onnx/resolve/main/cross_kv_fp16.onnx",
    name: "whisper-large-v3-turbo-decoder-cross-prefill.onnx",
    size: 26228595,
};

// notes:
// the whisper decoder would benefit from a mechanism for paged attention with prefix sharing
// (for beamsearch) and a mechanism for sharing the encoder output. This would lower memory usage
// quite severely and make more batching viable.

pub struct WhisperDecoderOrt {
    encoder: WhisperEncoderOrt,
    model: Session,
    decoder_prefill: Session,
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
            //.with_execution_providers([ep::WebGPU::default().build()])
            //.unwrap()
            .commit_from_file(model_path)?;

        let decoder_prefill_path = WHISPER_V3_LARGE_DECODER_PREFILL
            .ensure_downloaded(|_done, _total| {})
            .await?;
        let decoder_prefill = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap()
            //.with_execution_providers([ep::WebGPU::default().build()])
            //.unwrap()
            .commit_from_file(decoder_prefill_path)?;
        let tokenizer = Tokenizer::new().await?;

        Ok(Self {
            encoder,
            tokenizer,
            model,
            decoder_prefill,
        })
    }

    pub fn run_onnx_model(
        &mut self,
        encoded: Array3<f32>,
        input_ids: Array2<i64>,
        kv_cache: &mut KvCache,
    ) -> Result<ArrayD<f32>> {
        let start: Instant = Instant::now();

        let encoded_seq_len = encoded.shape()[1];
        assert_eq!(encoded_seq_len, 1500);

        let mut inputs = ort::inputs![
            "input_ids" => Tensor::from_array(input_ids)?,
            "encoder_hidden_states" => Tensor::from_array(encoded)?,
        ];

        let allocator = Allocator::new(
            &self.model,
            MemoryInfo::new(
                AllocationDevice::CPU,
                0,
                AllocatorType::Device,
                MemoryType::Default,
            )?,
        )?;
        kv_cache.add_self_to_ort_inputs(&allocator, &mut inputs)?;

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
        println!("forward pass of decoder took {}", duration.as_secs_f32());
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

    pub async fn transcribe(&mut self, _lang: &str) -> Result<()> {
        let encoded = self.encoder.get(0..self.encoder.len().min(16_000 * 30))?;

        let mut base = 0.0;
        for i in 0..7 {
            let batch_size = 2_usize.pow(i);
            let mut encoded_shape = encoded.shape().to_vec();
            encoded_shape[0] = batch_size;
            let encoded_shape: [usize; 3] = encoded_shape.try_into().unwrap();
            let mut encoded_batched = Array3::zeros(encoded_shape);
            for b in 0..batch_size {
                for (x, y) in encoded_batched
                    .slice_mut(s![b, .., ..])
                    .iter_mut()
                    .zip(encoded.iter())
                {
                    *x = *y;
                }
            }

            let kv_cache = &mut KvCache::default();

            let start: Instant = Instant::now();
            let outputs: ort::session::SessionOutputs<'_> = self
                .decoder_prefill
                .run(ort::inputs![
                    "encoder_hidden_states" => Tensor::from_array(encoded_batched.clone())?,
                ])
                .context("running the decoder onnx model failed")?;
            kv_cache.update_from_session_outputs(outputs);
            println!("computed cross attn kv cache in {:?}s", start.elapsed());

            let start = Instant::now();
            let mut sequence = vec![];
            // sequence.push(self.tokenizer.startofprev());
            // sequence.append(&mut self.tokenizer.encode(" transcribee.")?);
            sequence.append(&mut self.tokenizer.sot_sequence("en")?);
            for t in &sequence[..sequence.len() - 1] {
                let input_ids = Array2::from_shape_vec((batch_size, 1), vec![*t; batch_size])?;
                self.run_onnx_model(encoded_batched.clone(), input_ids, kv_cache)?;
            }
            loop {
                let input_ids = Array2::from_shape_vec(
                    (batch_size, 1),
                    vec![*sequence.last().unwrap(); batch_size],
                )?;
                let logits = self.run_onnx_model(encoded_batched.clone(), input_ids, kv_cache)?;

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

            let duration = start.elapsed();
            if batch_size == 1 {
                base = duration.as_secs_f64();
            }
            println!(
                "batch={batch_size} speedup={}",
                base / (duration.as_secs_f64() / batch_size as f64)
            )
        }

        Ok(())
    }
}

#[derive(Default)]
pub struct KvCache(HashMap<String, Value>);
impl KvCache {
    pub fn add_self_to_ort_inputs(
        &self,
        allocator: &Allocator,
        ort_inputs: &mut Vec<(
            std::borrow::Cow<'_, str>,
            ort::session::SessionInputValue<'_>,
        )>,
    ) -> Result<()> {
        for i in 0..4 {
            for name in ["decoder.key", "decoder.value"] {
                if self.0.contains_key(&format!("{i}.{name}")) {
                    continue;
                }
                ort_inputs.push((
                    format!("past_key_values.{i}.{name}").into(),
                    DynTensor::new(allocator, TensorElementType::Float16, [0usize, 20, 0, 64])
                        .unwrap()
                        .into(),
                ));
            }
        }

        let mut bytes = 0;
        for (k, v) in self.0.iter() {
            bytes += v.shape().iter().cloned().reduce(|acc, e| acc * e).unwrap() * 4;
            ort_inputs.push((format!("past_key_values.{k}").into(), v.clone().into()));
        }
        println!("kv cache bytes: {}", bytes as f32 / 1000. / 1000.);
        Ok(())
    }

    pub fn update_from_session_outputs(&mut self, outputs: ort::session::SessionOutputs<'_>) {
        for (name, v) in outputs.iter() {
            if let Some(name) = name.strip_prefix("present.") {
                let new_len = v.shape().iter().cloned().reduce(|acc, e| acc * e).unwrap();
                if new_len != 0 {
                    // the encoder kv entries are only produced in the first run
                    self.0.insert(name.to_string(), v.clone());
                }
            }
        }
    }

    fn zero_tensor(shape: &[usize]) -> Tensor<f32> {
        Tensor::from_array((
            shape,
            vec![0.0; shape.iter().cloned().reduce(|acc, e| acc * e).unwrap()],
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
        let ar = AudioReader::new("../worker/tests/data/sample.mp3").unwrap();
        let encoder = WhisperEncoderOrt::new(ar).await.unwrap();
        let mut decoder = WhisperDecoderOrt::new(encoder).await.unwrap();
        let langs = decoder.transcribe("en").await.unwrap();
    }
}
