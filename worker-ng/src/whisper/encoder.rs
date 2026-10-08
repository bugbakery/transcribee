use crate::model_downloader::RemoteModel;
use anyhow::Result;
use ndarray::{Array2, Array3, Axis};
use ort::{
    ep,
    session::{Session, builder::GraphOptimizationLevel},
    value::Value,
};
use stft_rs::{
    BatchStftF32, StftConfigF32,
    mel::{BatchMelSpectrogramF32, MelConfigF32},
};

pub const WHISPER_V3_LARGE_ENCODER: RemoteModel = RemoteModel {
    url: "https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/onnx/encoder_model_int8.onnx",
    name: "whisper-large-v3-turbo-encoder.onnx",
    size: 1274342603,
};

pub struct WhisperEncoderOrt {
    model: Session,
}
impl WhisperEncoderOrt {
    const SAMPLE_RATE: usize = 16_000;
    const CHUNK_LEN_S: usize = 30;

    pub async fn new() -> Result<Self> {
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

        Ok(Self { model })
    }

    pub fn get_mel(mut samples: Vec<f32>) -> Result<Array3<f32>> {
        let chunk_len = Self::SAMPLE_RATE * Self::CHUNK_LEN_S; // TODO: can we save compute when we process shorter chunks?
        assert!(samples.len() <= chunk_len);
        samples.resize(chunk_len, 0.0);

        let stft_config = StftConfigF32::builder()
            .fft_size(400)
            .hop_size(160)
            .window(stft_rs::WindowType::Hann)
            .reconstruction_mode(stft_rs::ReconstructionMode::Wola)
            .build()
            .unwrap();
        let stft = BatchStftF32::new(stft_config);

        let mel_config = MelConfigF32 {
            n_mels: 128,
            fmin: 0.0,
            fmax: None,
            mel_scale: stft_rs::mel::MelScale::Slaney,
            norm: stft_rs::mel::MelNorm::Slaney,
            use_power: true,
        };
        let mel_proc = BatchMelSpectrogramF32::new(16_000.0, 400, &mel_config);

        let spectrum = stft.process(&samples);
        let mel_spec = mel_proc.process(&spectrum);

        let mut result = Array3::<f32>::default((1, 128, 3000));
        for (bin, mut row) in result.axis_iter_mut(Axis(1)).enumerate() {
            for (frame, col) in row.iter_mut().enumerate() {
                if frame < mel_spec.num_frames {
                    *col = mel_spec.get(frame, bin).max(1e-10).log10();
                }
            }
        }

        let max_log = *result.iter().max_by(|a, b| a.total_cmp(b)).unwrap();
        result.map_inplace(|x| *x = (x.max(max_log - 8.0) + 4.0) / 4.0);

        Ok(result)
    }

    /// runs the encoder for the _input_ range specified here
    pub fn encode(&mut self, samples: Vec<f32>) -> Result<Array2<f32>> {
        // the large encoder processes 30s chunks that might be padded
        // input shape of the large encoder is [batch_size,128,3000]
        // output shape of the large encoder is [batch_size,1500,1280]
        let input = Self::get_mel(samples)?;
        let outputs: ort::session::SessionOutputs<'_> =
            self.model.run([Value::from_array(input)?.into()])?;
        let (_, output) = outputs["last_hidden_state"].try_extract_tensor::<f32>()?;
        let output_arr = Array2::from_shape_vec((1500, 1280), output.to_vec()).unwrap();

        Ok(output_arr)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::{
        audio_reader::AudioReader,
        util::{meanclose, read_ndarray_from_file, write_ndarray_to_file},
    };

    #[tokio::test]
    async fn test_encoder() {
        let ar = AudioReader::new("../worker/tests/data/sample.mp3").unwrap();
        let len = ar.len();
        let mut encoder = WhisperEncoderOrt::new().await.unwrap();
        let result = encoder.encode(ar.get(0..len).unwrap().to_vec()).unwrap();
        dbg!(result.shape());
        write_ndarray_to_file("target/rs_encoded.f32", &result).unwrap();
        let reference = read_ndarray_from_file("target/encoded.f32", result.shape()).unwrap();
        assert!(meanclose(result, reference, 0.1))
    }

    #[tokio::test]
    async fn test_mel() {
        let ar = AudioReader::new("../worker/tests/data/sample.mp3").unwrap();
        let len = ar.len();
        let result = WhisperEncoderOrt::get_mel(ar.get(0..len).unwrap().to_vec()).unwrap();
        write_ndarray_to_file("target/rs_mel.f32", &result).unwrap();
        let reference = read_ndarray_from_file("target/mel.f32", result.shape()).unwrap();
        assert!(meanclose(result, reference, 0.01))
    }
}
