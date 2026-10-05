use super::encoder::WhisperEncoderOrt;
use crate::{
    model_downloader::RemoteModel, util::write_ndarray_to_file, whisper::tokenizer::Tokenizer,
};
use anyhow::{Context, Result};
use compute::functions::softmax;
use ndarray::{Array2, Array3, Array4, ArrayD, Axis};
use ort::{
    session::{Session, builder::GraphOptimizationLevel},
    value::{Tensor, Value},
};
use std::{collections::HashMap, time::Instant};

pub const WHISPER_V3_LARGE_DECODER: RemoteModel = RemoteModel {
    url: "https://huggingface.co/onnx-community/whisper-large-v3-turbo_timestamped/resolve/main/onnx/decoder_model_merged_fp16.onnx",
    name: "whisper-large-v3-turbo-decoder.onnx",
    size: 344288457,
};
pub const ALIGNMENT_HEADS: [(usize, usize); 6] =
    [(2, 4), (2, 11), (3, 3), (3, 6), (3, 11), (3, 14)];

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
        alignment: Option<&mut AlignmentData>,
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

        kv_cache.update_from_session_outputs(&outputs);
        if let Some(alignment) = alignment {
            alignment.add_cross_attention_weights(&outputs)?;
        }

        let duration = start.elapsed();
        println!("forward pass of decoder took {}s", duration.as_secs_f32());
        Ok(logits)
    }

    pub async fn detect_language(&mut self) -> Result<Vec<(&str, f64)>> {
        let encoded = self.encoder.get(0..self.encoder.len().min(16_000 * 30))?;

        let input_ids =
            Array2::<i64>::from_shape_vec((1, 1), vec![self.tokenizer.startoftranscript()])
                .unwrap();

        let logits = self.run_onnx_model(encoded, input_ids, &mut KvCache::default(), None)?;

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
        let audio_frames = self.encoder.len().min(16_000 * 30);
        let encoded = self.encoder.get(0..audio_frames)?;
        let encoder_frames = audio_frames / 320;

        let kv_cache = &mut KvCache::default();
        let alignment = &mut AlignmentData::default();
        let mut sequence = vec![];
        // sequence.push(self.tokenizer.startofprev());
        //sequence.append(&mut self.tokenizer.encode(" transcribee.")?);
        //sequence.append(&mut self.tokenizer.sot_sequence("en")?);
        sequence.append(&mut vec![
            50258, 50259, 50360, 50364, 639, 307, 364, 6278, 1500, 3991, 13, 467, 486, 312, 1143,
            281, 1500, 264, 35288, 11582, 295, 6531, 1142, 5614, 11, 264, 1269, 4009, 35288, 4722,
            13, 50257,
        ]);
        loop {
            let input_ids = if matches!(kv_cache, KvCache::Empty) {
                Array2::<i64>::from_shape_vec((1, sequence.len()), sequence.clone())?
            } else {
                Array2::from_shape_vec((1, 1), vec![*sequence.last().unwrap()])?
            };

            let logits =
                self.run_onnx_model(encoded.clone(), input_ids, kv_cache, Some(alignment))?;

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
            break;
        }

        dbg!(encoder_frames);
        let token_timings = alignment.calculate_alignment(encoder_frames)?;
        let frames_per_second = 1500. / 30.;
        for (i, token) in sequence.iter().enumerate() {
            println!(
                "{{\"conf\":1,\"conf_ts\":1,\"start\":{},\"end\":{},\"text\":\"{}\"}},",
                token_timings[i] as f32 / frames_per_second,
                token_timings[i + 1] as f32 / frames_per_second,
                self.tokenizer.decode(&[*token])?,
            )
        }
        dbg!(token_timings.len());
        println!("{:?}", token_timings);
        Ok(())
    }
}

#[derive(Default)]
pub enum KvCache {
    #[default]
    Empty,
    Full(HashMap<String, Value>),
}
impl KvCache {
    pub fn add_self_to_ort_inputs(
        &self,
        _decoder_seq_len: usize,
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
                            Tensor::from_array(([0, 20, 0, 64], vec![0.0f32; 0]))
                                .unwrap()
                                .into(),
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

    pub fn update_from_session_outputs(&mut self, outputs: &ort::session::SessionOutputs<'_>) {
        if matches!(self, KvCache::Empty) {
            *self = KvCache::Full(HashMap::new());
        }
        let KvCache::Full(map) = self else {
            unreachable!()
        };
        for (name, v) in outputs.iter() {
            if let Some(name) = name.strip_prefix("present.") {
                let new_len = v.shape().iter().cloned().reduce(|acc, e| acc * e).unwrap();
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
            vec![0.0; shape.iter().cloned().reduce(|acc, e| acc * e).unwrap()],
        ))
        .unwrap()
    }
}

#[derive(Default)]
pub struct AlignmentData(Vec<Array4<f32>>); // batch, alignment_heads, tokens, encoder_frames
impl AlignmentData {
    pub fn add_cross_attention_weights(
        &mut self,
        outputs: &ort::session::SessionOutputs<'_>,
    ) -> Result<()> {
        let mut cross_attentions = Vec::new();
        for i in 0..4 {
            let (shape, data) = outputs[format!("cross_attentions.{i}")]
                .try_extract_tensor::<f32>()
                .unwrap();
            let data = ArrayD::from_shape_vec(
                shape.iter().map(|x| *x as usize).collect::<Vec<_>>(),
                data.to_vec(),
            )?;
            write_ndarray_to_file(&format!("target/qk_ours{i}.f32"), &data).unwrap();
            cross_attentions.push(data);
        }

        let batch_size = cross_attentions[0].shape()[0];
        let tokens = cross_attentions[0].shape()[2];
        let encoder_frames = cross_attentions[0].shape()[3];

        let mut next =
            Array4::<f32>::zeros((batch_size, ALIGNMENT_HEADS.len(), tokens, encoder_frames));
        for (head_idx, (block, idx)) in ALIGNMENT_HEADS.into_iter().enumerate() {
            for batch in 0..batch_size {
                for token in 0..tokens {
                    for audio_frame in 0..encoder_frames {
                        *next.get_mut((batch, head_idx, token, audio_frame)).unwrap() =
                            *cross_attentions[block]
                                .get([batch, idx, token, audio_frame])
                                .unwrap();
                    }
                }
            }
        }

        self.0.push(next);
        Ok(())
    }

    fn get_merged(&self, num_frames: usize) -> Array4<f32> {
        let batch_size = self.0[0].shape()[0];
        let heads = self.0[0].shape()[1];
        let tokens = self.0.iter().map(|x| x.shape()[2]).sum();
        let encoder_frames = self.0[0].shape()[3];
        assert!(num_frames <= encoder_frames);

        let mut merged = Array4::zeros((batch_size, heads, tokens, num_frames));
        let mut tokens_processed = 0;
        for slice in self.0.iter() {
            assert_eq!(slice.shape()[0], batch_size);
            assert_eq!(slice.shape()[1], heads);
            let slice_tokens = slice.shape()[2];
            assert_eq!(slice.shape()[3], encoder_frames);
            for b in 0..batch_size {
                for h in 0..heads {
                    for t in 0..slice_tokens {
                        for f in 0..num_frames {
                            *merged.get_mut((b, h, t + tokens_processed, f)).unwrap() =
                                *slice.get((b, h, t, f)).unwrap();
                        }
                    }
                }
            }

            tokens_processed += slice_tokens;
        }

        merged
    }

    fn calculate_alignment(&self, num_frames: usize) -> Result<Vec<usize>> {
        let merged = self.get_merged(num_frames);
        let batch_size = merged.shape()[0];
        let heads = merged.shape()[1];
        let tokens = merged.shape()[2];
        dbg!(tokens);
        let frames = merged.shape()[3];

        // 1. do softmax to the last axis (audio chunks)
        // this is already folded into the onnx model so we skip this step
        // let mut divisor = Array4::<f32>::zeros((batch_size, heads, tokens, 1));
        // for b in 0..batch_size {
        //     for h in 0..heads {
        //         for t in 0..tokens {
        //             *divisor.get_mut((b, h, t, 0)).unwrap() = (0..frames)
        //                 .map(|f| merged.get((b, h, t, f)).unwrap().exp())
        //                 .sum()
        //         }
        //     }
        // }
        // let softmaxed = merged.exp() / divisor;

        // 2. rescale by mean and std in the second to last axis (tokens)
        let std = merged.std_axis(Axis(2), 0.0);
        let mean = merged.mean_axis(Axis(2)).unwrap();
        let scaled = (merged - mean.insert_axis(Axis(2))) / std.insert_axis(Axis(2));

        // 3. apply a median filter along the last axis (audio chunks) probably for denoising
        const MEDFILT_WIDTH: usize = 7;
        let mut filtered = Array4::zeros((batch_size, heads, tokens, frames));
        for b in 0..batch_size {
            for h in 0..heads {
                for t in 0..tokens {
                    for f in 0..frames {
                        let window = &mut [0.0; MEDFILT_WIDTH];
                        for x in 0..MEDFILT_WIDTH {
                            let idx = f + x;
                            let idx = if idx > MEDFILT_WIDTH / 2 {
                                let idx = idx - MEDFILT_WIDTH / 2;
                                if idx < frames {
                                    idx
                                } else {
                                    frames - (idx - frames) - 1
                                }
                            } else {
                                MEDFILT_WIDTH / 2 - idx
                            };
                            window[x] = *scaled.get((b, h, t, idx)).unwrap();
                        }
                        window.sort_unstable_by(|a, b| a.total_cmp(b));
                        *filtered.get_mut((b, h, t, f)).unwrap() = window[MEDFILT_WIDTH / 2];
                    }
                }
            }
        }

        // 4. take the mean of all heads
        let heads_combined = filtered.mean_axis(Axis(1)).unwrap();

        write_ndarray_to_file(
            "target/alignment_weights_ours.f32",
            &heads_combined.to_owned(),
        )
        .unwrap();

        // 6. do dtw
        let dtw_result = Self::dtw(-heads_combined.outer_iter().next().unwrap().to_owned());

        // postprocess dtw output to be start & end time per token
        let mut jumps = vec![dtw_result.first().unwrap().1];
        for (token, frame) in dtw_result {
            if jumps.len() - 1 != token {
                jumps.push(frame);
            }
        }
        Ok(jumps)
    }

    fn dtw(x: Array2<f32>) -> Vec<(usize, usize)> {
        let tokens = x.shape()[0];
        let frames = x.shape()[1];
        dbg!(tokens, frames);
        let mut cost = Array2::from_elem((tokens + 1, frames + 1), f32::INFINITY);
        let mut trace = Array2::from_elem((tokens + 1, frames + 1), -1i8);

        *cost.get_mut((0, 0)).unwrap() = 0.0;
        for frame in 1..frames + 1 {
            for token in 1..tokens + 1 {
                let c0 = cost.get((token - 1, frame - 1)).unwrap();
                let c1 = cost.get((token - 1, frame)).unwrap();
                let c2 = cost.get((token, frame - 1)).unwrap();

                let (c, t) = if c0 < c1 && c0 < c2 {
                    (c0, 0)
                } else if c1 < c0 && c1 < c2 {
                    (c1, 1)
                } else {
                    (c2, 2)
                };

                *cost.get_mut((token, frame)).unwrap() = x.get((token - 1, frame - 1)).unwrap() + c;
                *trace.get_mut((token, frame)).unwrap() = t;
            }
        }
        Self::backtrace(&mut trace)
    }

    fn backtrace(trace: &mut Array2<i8>) -> Vec<(usize, usize)> {
        let mut token = trace.shape()[0] - 1;
        let mut frame = trace.shape()[1] - 1;
        for f in 0..frame {
            *trace.get_mut((0, f)).unwrap() = 2
        }
        for t in 0..token {
            *trace.get_mut((t, 0)).unwrap() = 1
        }

        let mut result = vec![];
        while token > 0 || frame > 0 {
            result.push((token - 1, frame - 1));
            let elem = *trace.get((token, frame)).unwrap();
            if elem == 0 {
                token -= 1;
                frame -= 1;
            } else if elem == 1 {
                token -= 1;
            } else if elem == 2 {
                frame -= 1;
            } else {
                unreachable!();
            }
        }
        result.reverse();

        result
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
