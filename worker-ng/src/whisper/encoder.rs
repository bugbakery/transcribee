use std::{
    hint::black_box,
    ops::Range,
    time::{self, Duration},
};
use crate::{audio_reader::AudioReader, model_downloader::RemoteModel};
use anyhow::Result;
use ndarray::{Array3, Axis};
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

pub struct WhisperEncoderOrt {
    model: Session,
    src: AudioReader,
}
impl WhisperEncoderOrt {
    const SAMPLE_RATE: usize = 16_000;
    const CHUNK_LEN_S: usize = 30;

    pub async fn new(src: AudioReader) -> Result<Self> {
        let model_path = WHISPER_V3_LARGE_ENCODER
            .ensure_downloaded(|_done, _total| {})
            .await?;
        let model = Session::builder()?
            // we cannot use concurrent WebGPU EPs currently due to an upstream bug (fix landed; waiting for release)
            // https://github.com/microsoft/onnxruntime/issues/31627
            .with_execution_providers([ep::WebGPU::default().build()])
            .unwrap()
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap()
            .commit_from_file(model_path)?;

        Ok(Self { model, src })
    }

    /// runs the encoder for the _input_ range specified here
    pub fn get(&mut self, range: Range<usize>) -> Result<Array3<f32>> {
        // the large encoder processes 30s chunks that might be padded
        // input shape of the large encoder is [batch_size,128,3000]
        // output shape of the large encoder is [batch_size,1500,1280]
        let range_len = range.end - range.start;
        let chunk_len = Self::SAMPLE_RATE * Self::CHUNK_LEN_S; // TODO: can we save compute when we process shorter chunks?
        assert!(range_len <= chunk_len);

        let mut samples = self.src.get(range)?.to_vec();
        samples.resize(chunk_len, 0.0);
        let mel = mel_spec::stft::Spectrogram::compute_mel_spectrogram_cpu(
            &samples,
            400,
            160,
            128,
            Self::SAMPLE_RATE as f64,
        );
        let mut input = Array3::<f32>::default((1, 128, 3000));
        for (i, mut row) in input.axis_iter_mut(Axis(0)).enumerate() {
            for (j, col) in row.iter_mut().enumerate() {
                if j < mel.len() {
                    *col = mel[j][i];
                }
            }
        }

        let outputs: ort::session::SessionOutputs<'_> =
            self.model.run([Value::from_array(input)?.into()])?;
        let (_, output) = outputs["last_hidden_state"].try_extract_tensor::<f32>()?;
        let output_arr = Array3::from_shape_vec((1, 1500, 1280), output.to_vec()).unwrap();

        Ok(output_arr)
    }

    pub fn benchmark(&mut self, batch_size: usize) -> Result<Duration> {
        let start = time::Instant::now();
        let inputs = Array3::<f32>::zeros((batch_size, 128, 3000));
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

    pub fn len(&self) -> usize {
        self.src.len()
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[tokio::test]
    async fn test_benchmark() {
        let ar = AudioReader::new("../worker/tests/data/sample.mp3").unwrap();
        let mut encoder = WhisperEncoderOrt::new(ar).await.unwrap();
        let mut perf_one = None;
        for i in 1..3 {
            let duration = encoder.benchmark(i).unwrap();
            if perf_one.is_none() {
                perf_one = Some(duration);
            }
            println!(
                "batch_size={i} duration={duration:?} speed={}",
                perf_one.unwrap().as_secs_f32() / (duration.as_secs_f32() / i as f32)
            )
        }
    }

    #[tokio::test]
    async fn test_encoder() {
        let ar = AudioReader::new("../worker/tests/data/sample.mp3").unwrap();
        let len = ar.len();
        let mut encoder = WhisperEncoderOrt::new(ar).await.unwrap();
        let result = encoder.get(0..len).unwrap();
        black_box(result);
    }
}
