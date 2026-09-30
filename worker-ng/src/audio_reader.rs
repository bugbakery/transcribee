use anyhow::Result;
use ez_ffmpeg::frame_export::SampleExtractor;
use std::ops::Range;

pub const OUTPUT_SR: u32 = 16_000;

// TODO: this is a placeholder implementation that loads the entire decoded file into memory which
// is not good enough for our final usecase (230mb mem usage per hour of audio for no reason)
pub struct AudioReader {
    samples: Vec<f32>,
}
impl AudioReader {
    pub fn new(path: &str) -> Result<Self> {
        let samples = SampleExtractor::new(path)
            .channels(ez_ffmpeg::frame_export::Channels::Mono)
            .sample_rate(OUTPUT_SR)
            .collect_samples()?;
        return Ok(Self { samples });
    }

    pub fn get(&self, range: Range<usize>) -> Result<&[f32]> {
        Ok(&self.samples[range])
    }

    pub fn len(&self) -> usize {
        self.samples.len()
    }

    pub fn sample_rate(&self) -> f32 {
        OUTPUT_SR as f32
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_smoke() {
        let ar = AudioReader::new("../worker/tests/data/sample.mp3").unwrap();
        assert!(
            *ar.get(0..1000)
                .unwrap()
                .iter()
                .max_by(|a, b| a.total_cmp(b))
                .unwrap()
                < 1.0
        );
        assert_eq!(ar.len(), 194197);
    }
}
