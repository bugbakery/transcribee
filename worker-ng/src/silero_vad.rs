use std::ops::Range;

use crate::{audio_reader::AudioReader, model_downloader::RemoteModel};
use anyhow::Result;
use ndarray::{Array1, Array2, ArrayD};
use ort::{
    session::{Session, builder::GraphOptimizationLevel},
    value::Value,
};

pub const SILERO_VAD: RemoteModel = RemoteModel {
    url: "https://huggingface.co/BricksDisplay/silero-vad-6.2/resolve/main/onnx/model_fp16.onnx",
    name: "silero.onnx",
    size: 1228183,
};

pub struct SileroVadModel {
    output: Vec<f32>,
    sample_rate: f32,
}
impl SileroVadModel {
    const context_size: usize = 64; // for some reason we use the last 64 samples again
    const chunk_size: usize = 512; // ~32ms at 16khz sample rate

    pub async fn new(src: AudioReader) -> Result<Self> {
        // TODO: we are currently doing all the computation here, this is maybe not the best idea

        let model_path = SILERO_VAD.ensure_downloaded(|_done, _total| {}).await?;

        let mut model = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap()
            .commit_from_file(model_path)?;

        // the LSTM state
        let mut state = ArrayD::<f32>::zeros([2, 1, 128].as_slice());
        let sample_rate = Array1::from_shape_vec([1], vec![src.sample_rate() as i64]).unwrap();

        let mut output = Vec::with_capacity(src.len() / Self::chunk_size);
        for i in 0..(src.len() / Self::chunk_size) {
            let start_sample = i * Self::chunk_size;
            let end_sample = start_sample + Self::chunk_size;
            let samples = if start_sample >= Self::context_size {
                src.get((start_sample - 64)..end_sample)?.to_vec()
            } else {
                let mut context = vec![0.0; 64];
                context.extend_from_slice(src.get(start_sample..end_sample)?);
                context
            };
            let samples = Array2::<f32>::from_shape_vec([1, samples.len()], samples).unwrap();
            let outputs: ort::session::SessionOutputs<'_> = model.run([
                Value::from_array(samples)?.into(),
                Value::from_array(state)?.into(),
                Value::from_array(sample_rate.clone())?.into(),
            ])?;
            let prob = *outputs["output"]
                .try_extract_tensor::<f32>()
                .unwrap()
                .1
                .first()
                .unwrap();
            output.push(prob);
            let (shape, state_data) = outputs["stateN"].try_extract_tensor::<f32>()?;
            let shape_usize: Vec<usize> = shape.as_ref().iter().map(|&d| d as usize).collect();
            state = ArrayD::from_shape_vec(shape_usize.as_slice(), state_data.to_vec()).unwrap();
        }

        let sample_rate = src.sample_rate() / Self::chunk_size as f32;
        Ok(Self {
            output,
            sample_rate,
        })
    }

    pub fn get(&self, range: Range<usize>) -> Result<Vec<f32>> {
        Ok(self.output[range].to_vec())
    }

    pub fn len(&self) -> usize {
        self.output.len()
    }

    pub fn sample_rate(&self) -> f32 {
        self.sample_rate
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[tokio::test]
    async fn test_smoke() {
        let ar = AudioReader::new("../worker/tests/data/sample.mp3").unwrap();
        let vad = SileroVadModel::new(ar).await.unwrap();
        assert!(
            *vad.get(0..100)
                .unwrap()
                .iter()
                .max_by(|a, b| a.total_cmp(b))
                .unwrap()
                <= 1.0
        );
        assert_eq!(vad.len(), 379);
    }
}
