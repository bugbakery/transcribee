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
        b!("Burn Metal", WhisperEncoderBurn::new(burn_tensor::Device::metal(Default::default()), "./target/whisper_large_v3_turbo.safetensors")),
        b!("Burn WebGPU", WhisperEncoderBurn::new(burn_tensor::Device::wgpu(Default::default()), "./target/whisper_large_v3_turbo.safetensors")),
        b!("ONNX Runtime WebGPU", WhisperEncoderOrt::new(WebGPU, "./target/")),

        b!("MLX CPU", WhisperEncoderMlx::new(mlx_rs::DeviceType::Cpu, "./target/whisper_large_v3_turbo.safetensors")),
        b!("Burn flex (CPU)", WhisperEncoderBurn::new(burn_tensor::Device::flex(), "./target/whisper_large_v3_turbo.safetensors")),
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
                *col = mel_spec.get(bin, frame).max(1e-10).log10();
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
    use crate::audio_reader::AudioReader;
    use crate::whisper::reference::assert_similiar_to_reference;

    #[tokio::test]
    async fn test_mel() {
        let ar = AudioReader::new("../worker/tests/data/sample.mp3").unwrap();
        let mel = compute_mel(ar.get(0..ar.len()).unwrap().to_vec()).unwrap();
        assert_similiar_to_reference("mel.npy", mel.into_dyn(), 0.0002);
    }

    #[cfg(feature = "slow-tests")]
    #[tokio::test]
    async fn test_backends() {
        use crate::whisper::reference::{
            get_reference_data, get_reference_folder, is_similiar, write_ndarray_to_file,
        };
        crate::WHISPER_LARGE_V3_TURBO
            .ensure_downloaded(|_, _| {})
            .await
            .unwrap();
        let mel = get_reference_data("mel.npy");
        let mut fail = false;
        for (name, backend) in get_backends("") {
            println!("\ntesting backend {name}");
            let mut backend = backend().unwrap();
            let encoded = backend
                .encode(mel.clone().into_dimensionality().unwrap())
                .unwrap();
            let reference = get_reference_data("encoded.npy");
            let is_similiar = is_similiar(reference.clone(), encoded.clone().into_dyn(), 0.05);
            let folder = get_reference_folder();
            write_ndarray_to_file(
                &folder.join(format!("encoded_{name}.npy")),
                encoded.into_dyn(),
            );
            if is_similiar {
                println!("-> PASS: backend {name} is similiar to encoder reference\n");
            } else {
                println!("-> FAIL: backend {name} is not similiar to encoder reference\n");
                fail = true;
            }
        }
        assert!(!fail);
    }
}
