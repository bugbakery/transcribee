use std::time::Instant;

use crate::{
    safetensors_reader::SafetensorsFile,
    whisper::{burn_backend::layers::WeightlessBurnModel, encoder::WhisperEncoderBackend},
};
use anyhow::Result;
use burn_tensor::{
    DType::{F16, F32},
    Device, DeviceConfig,
    IntDType::I64,
    Tensor, TensorCreationOptions, TensorData,
    activation::gelu,
    ops::ConvOptions,
};
use log::info;
use ndarray::Array2;

pub struct WhisperEncoderBurn {
    device: Device,
    model: WeightlessBurnModel,
}
impl WhisperEncoderBurn {
    pub fn new(mut device: Device, safetensors_path: &str) -> Result<Self> {
        device.configure(DeviceConfig::new(Some(F16.into()), Some(I64), None))?;
        let device = device.without_autodiff();
        let safetensors_file = SafetensorsFile::new(safetensors_path)?;
        let model = WeightlessBurnModel::new(safetensors_file, device.clone());

        Ok(Self { model, device })
    }
}
impl WhisperEncoderBurn {
    fn forward(&mut self, name: &str, x: Tensor<3>) -> Tensor<3> {
        let x = gelu(self.model.conv1d(
            &format!("{name}.conv1"),
            x,
            ConvOptions::new_with_padding([1], [(1, 1)], [1], 1),
        ));
        let x = gelu(self.model.conv1d(
            &format!("{name}.conv2"),
            x,
            ConvOptions::new_with_padding([2], [(1, 1)], [1], 1),
        ));
        let x = x.permute([0, 2, 1]);
        let mut x = x + self
            .model
            .initializer::<2>(&format!("{name}.embed_positions.weight"))
            .unsqueeze();
        for i in 0..32 {
            x = self
                .model
                .residual_attention_block(&format!("{name}.layers.{i}"), x, 20);
        }
        let x = self.model.layer_norm(&format!("{name}.layer_norm"), x);
        return x;
    }
}
impl WhisperEncoderBackend for WhisperEncoderBurn {
    fn encode(&mut self, mel: Array2<f32>) -> Result<Array2<f32>> {
        let mut shape = mel.shape().to_vec();
        let (vec, offset) = mel.into_raw_vec_and_offset();
        assert_eq!(offset, Some(0));
        shape.insert(0, 1);
        let input = Tensor::<3>::from_data(
            TensorData::new(vec, shape),
            TensorCreationOptions::new(self.device.clone()).with_dtype(F32),
        )
        .cast(F16);

        let start = Instant::now();
        let output = self.forward("model.encoder", input).cast(F32).into_data();
        self.device.sync()?;
        info!("encoder took: {:?}", start.elapsed());

        let output = output.try_to_vec_as()?;
        let output_arr = Array2::from_shape_vec([1280, 1500], output)?;

        Ok(output_arr)
    }
}
