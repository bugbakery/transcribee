use std::{
    hint::black_box,
    ops::Range,
    time::{self, Duration},
};

use crate::{audio_reader::AudioReader, model_downloader::RemoteModel};
use anyhow::Result;
use ndarray::ArrayD;
use ort::{
    ep,
    session::{Session, builder::GraphOptimizationLevel},
    value::Value,
};

pub const WHISPER_V3_LARGE_ENCODER: RemoteModel = RemoteModel {
    url: "https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/onnx/encoder_model_fp16.onnx",
    name: "whisper-large-v3-turbo-encoder.onnx",
    size: 1274342603,
};

pub const WHISPER_V3_LARGE_DECODER: RemoteModel = RemoteModel {
    url: "https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/onnx/decoder_with_past_model_fp16.onnx",
    name: "whisper-large-v3-turbo-decoder.onnx",
    size: 317771757,
};

pub struct WhisperEncoderOrt {
    model: Session,
    src: AudioReader,
}
impl WhisperEncoderOrt {
    pub async fn new(src: AudioReader) -> Result<Self> {
        let model_path = WHISPER_V3_LARGE_ENCODER
            .ensure_downloaded(|_done, _total| {})
            .await?;

        let model = Session::builder()?
            .with_execution_providers([ep::WebGPU::default().build()]).unwrap()
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap()
            .commit_from_file(model_path)?;

        Ok(Self { model, src })
    }

    /// runs the encoder for the _input_ range specified here
    pub fn get(range: Range<usize>) {
        // the large encoder processes 30s chunks that might be padded
        // input shape of the large encoder is [batch_size,128,3000]
        // output shape of the large encoder is [batch_size,1500,1280]
    }

    pub fn benchmark(&mut self, batch_size: usize) -> Result<Duration> {
        let start = time::Instant::now();
        let inputs = ArrayD::<f32>::zeros([batch_size, 128, 3000].as_ref());
        let outputs: ort::session::SessionOutputs<'_> =
            self.model.run([Value::from_array(inputs)?.into()])?;
        let output = *outputs["last_hidden_state"]
            .try_extract_tensor::<f32>()
            .unwrap()
            .1
            .first()
            .unwrap();
        black_box(output);
        Ok(start.elapsed())
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[tokio::test]
    async fn test_smoke() {
        let ar = AudioReader::new("../worker/tests/data/sample.mp3").unwrap();
        let mut encoder = WhisperEncoderOrt::new(ar).await.unwrap();
        let mut perf_one = None;
        for i in 1..4 {
            let duration = encoder.benchmark(i).unwrap();
            if perf_one.is_none() {
                perf_one = Some(duration);
            }
            println!("batch_size={i} duration={duration:?} speed={}", perf_one.unwrap().as_secs_f32() / (duration.as_secs_f32() / i as f32))
        }
    }
}
