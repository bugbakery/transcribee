use std::ops::Range;

use crate::audio_reader::AudioReader;
use anyhow::Result;

pub struct EarshotVadModel {
    output: Vec<f32>,
    sample_rate: f32,
}

impl EarshotVadModel {
    const chunk_size: usize = 256; // ~16ms at 16khz sample rate

    pub async fn new(src: AudioReader) -> Result<Self> {
        // TODO: we are currently doing all the computation here, this is maybe not the best idea

        let mut detector = earshot::Detector::default();
        let mut output = Vec::with_capacity(src.len() / Self::chunk_size);
        for i in 0..(src.len() / Self::chunk_size) {
            let start_sample = i * Self::chunk_size;
            let end_sample = start_sample + Self::chunk_size;
            let samples = src.get(start_sample..end_sample)?;
            let score = detector.predict_f32(&samples);
            output.push(score);
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
        let vad = EarshotVadModel::new(ar).await.unwrap();
        assert!(
            *vad.get(0..100)
                .unwrap()
                .iter()
                .max_by(|a, b| a.total_cmp(b))
                .unwrap()
                <= 1.0
        );
        assert_eq!(vad.len(), 758);
    }
}
