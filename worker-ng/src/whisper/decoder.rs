use super::encoder::WhisperEncoderOrt;
use crate::{model_downloader::RemoteModel, whisper::tokenizer::Tokenizer};
use anyhow::Result;
use compute::functions::softmax;
use ndarray::{Array2, ArrayD};
use ort::{
    session::{Session, builder::GraphOptimizationLevel},
    value::Value,
};
use std::time::Instant;

pub const WHISPER_V3_LARGE_DECODER: RemoteModel = RemoteModel {
    url: "https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/onnx/decoder_model_fp16.onnx",
    name: "whisper-large-v3-turbo-decoder.onnx",
    size: 344003183,
};
// TODO: add back kv-caching
// pub const WHISPER_V3_LARGE_DECODER: RemoteModel = RemoteModel {
//     url: "https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/onnx/decoder_with_past_model_fp16.onnx",
//     name: "whisper-large-v3-turbo-decoder.onnx",
//     size: 317771757,
// };

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

    pub async fn detect_language(&mut self) -> Result<Vec<(&str, f64)>> {
        let encoded = self.encoder.get(0..self.encoder.len().min(16_000 * 30))?;

        let input_ids =
            Array2::<i64>::from_shape_vec((1, 1), vec![self.tokenizer.startoftranscript()])
                .unwrap();

        let start = Instant::now();
        let outputs: ort::session::SessionOutputs<'_> = self.model.run([
            Value::from_array(input_ids)?.into(),
            Value::from_array(encoded)?.into(),
        ])?;
        let (shape, data) = outputs["logits"].try_extract_tensor::<f32>().unwrap();
        let logits = ArrayD::from_shape_vec(
            shape.iter().map(|x| *x as usize).collect::<Vec<_>>(),
            data.to_vec(),
        )?;
        let duration = start.elapsed();
        println!("forward pass of decoder took {}s", duration.as_secs_f32());

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

        let mut sequence = vec![];
        // sequence.push(self.tokenizer.startofprev());
        // sequence.append(&mut self.tokenizer.encode("Some jargon: transcribee.")?);
        sequence.append(&mut self.tokenizer.sot_sequence("en")?);
        loop {
            let input_ids = Array2::<i64>::from_shape_vec((1, sequence.len()), sequence.clone())?;
            let start = Instant::now();
            let outputs: ort::session::SessionOutputs<'_> = self.model.run([
                Value::from_array(input_ids)?.into(),
                Value::from_array(encoded.clone())?.into(),
            ])?;
            let (shape, data) = outputs["logits"].try_extract_tensor::<f32>().unwrap();
            let logits = ArrayD::from_shape_vec(
                shape.iter().map(|x| *x as usize).collect::<Vec<_>>(),
                data.to_vec(),
            )?;
            let duration = start.elapsed();
            println!("forward pass of decoder took {}s", duration.as_secs_f32());

            let batch = logits.outer_iter().next().unwrap();
            let greedy_decoded: Vec<u32> = batch
                .outer_iter()
                .map(|logits| {
                    logits
                        .iter()
                        .enumerate()
                        .max_by(|(_, x), (_, y)| x.total_cmp(y))
                        .unwrap()
                        .0 as u32
                })
                .collect();
            let best = *greedy_decoded.last().unwrap() as i64;
            sequence.push(best);
            let de_tokenized = self.tokenizer.decode(&greedy_decoded)?;
            println!("{de_tokenized}");
            if best == self.tokenizer.endoftext() {
                break;
            }
        }

        Ok(())
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
