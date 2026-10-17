use std::time::Instant;

use super::layers::WeightlessMLXModel;
use crate::{safetensors_reader::SafetensorsFile, whisper::encoder::WhisperEncoderBackend};
use anyhow::Result;
use log::info;
use mlx_rs::{Array, Device, DeviceType, Dtype::Float16, with_device};
use ndarray::Array2;

pub struct WhisperEncoderMlx {
    model: WeightlessMLXModel,
    device: DeviceType,
}
impl WhisperEncoderMlx {
    pub fn new(device: DeviceType, safetensors_path: &str) -> Result<Self> {
        let safetensors_file = SafetensorsFile::new(safetensors_path)?;
        let model = WeightlessMLXModel::new(safetensors_file);

        Ok(Self { model, device })
    }
}
impl WhisperEncoderMlx {
    fn forward(&mut self, name: &str, x: Array) -> Array {
        let x = x.transpose_axes(&[0, 2, 1]).unwrap();
        let x = WeightlessMLXModel::gelu(self.model.conv1d(
            &format!("{name}.conv1"),
            x,
            Some(1),
            Some(1),
        ));
        let x = WeightlessMLXModel::gelu(self.model.conv1d(
            &format!("{name}.conv2"),
            x,
            Some(2),
            Some(1),
        ));
        let mut x = x + self
            .model
            .initializer(&format!("{name}.embed_positions.weight"));
        for i in 0..32 {
            x = self
                .model
                .residual_attention_block(&format!("{name}.layers.{i}"), x, 20);
        }
        let x = self.model.layer_norm(&format!("{name}.layer_norm"), x);
        return x;
    }
}
impl WhisperEncoderBackend for WhisperEncoderMlx {
    fn encode(&mut self, mel: Array2<f32>) -> Result<Array2<f32>> {
        let mut shape: Vec<i32> = mel.shape().iter().map(|x| *x as i32).collect();
        let (vec, offset) = mel.into_raw_vec_and_offset();
        assert_eq!(offset, Some(0));
        shape.insert(0, 1);
        let mel = mlx_rs::Array::from_slice(&vec, &shape);
        let mel = match self.device {
            DeviceType::Gpu => mel.as_dtype(Float16).unwrap(),
            DeviceType::Cpu => mel,
        };

        let start = Instant::now();
        let output: Vec<f32> = with_device(Device::new(self.device, 0), || {
            let output = self.forward("model.encoder", mel);
            output.to_vec_cast().unwrap()
        });
        info!("encoder took: {:?}", start.elapsed());

        let output_arr = Array2::from_shape_vec([1280, 1500], output)?;
        Ok(output_arr)
    }
}
