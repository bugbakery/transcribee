use crate::whisper::{
    burn_backend::encoder::WhisperEncoderBurn,
    mlx_backend::encoder::WhisperEncoderMlx,
    onnx_backend::{
        Backend::{CPU, WebGPU},
        encoder::WhisperEncoderOrt,
    },
};
use anyhow::Result;
use ndarray::{Array2, Axis};
use stft_rs::{
    BatchStftF32, StftConfigF32,
    mel::{BatchMelSpectrogramF32, MelConfigF32},
};

const SAMPLE_RATE: usize = 16_000;
const CHUNK_LEN_S: usize = 30;

pub type DynWhisperEncoderBackend = Box<dyn WhisperEncoderBackend>;

pub fn get_backends(
    model_folder: &str,
) -> Vec<(&str, Box<dyn Fn() -> Result<DynWhisperEncoderBackend>>)> {
    macro_rules! b {
        ($name:expr, $init:expr) => {
            ($name, Box::new(|| ($init).map(|b| Box::new(b) as _)))
        };
    }

    #[rustfmt::skip]
    let backends: Vec<(&str, Box<dyn Fn() -> Result<DynWhisperEncoderBackend>>)> = vec![
        b!("MLX GPU", WhisperEncoderMlx::new(mlx_rs::DeviceType::Gpu, "./target/whisper_large_v3_turbo.safetensors")),
        b!("MLX CPU", WhisperEncoderMlx::new(mlx_rs::DeviceType::Cpu, "./target/whisper_large_v3_turbo.safetensors")),
        b!("Burn Metal", WhisperEncoderBurn::new(burn_tensor::Device::metal(Default::default()), "./target/whisper_large_v3_turbo.safetensors")),
        b!("Burn WebGPU", WhisperEncoderBurn::new(burn_tensor::Device::wgpu(Default::default()), "./target/whisper_large_v3_turbo.safetensors")),
        b!("Burn flex (CPU)", WhisperEncoderBurn::new(burn_tensor::Device::flex(), "./target/whisper_large_v3_turbo.safetensors")),
        b!("ONNX Runtime WebGPU", WhisperEncoderOrt::new(WebGPU, "./target/")),
        b!("ONNX Runtime CPU", WhisperEncoderOrt::new(CPU, "./target/")),
    ];
    backends
}

pub trait WhisperEncoderBackend {
    fn encode(&mut self, mel: Array2<f32>) -> Result<Array2<f32>>;
}

pub fn compute_mel(mut samples: Vec<f32>) -> Result<Array2<f32>> {
    let chunk_len = SAMPLE_RATE * CHUNK_LEN_S; // TODO: can we save compute when we process shorter chunks?
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

    let mut result = Array2::<f32>::default((128, 3000));
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
