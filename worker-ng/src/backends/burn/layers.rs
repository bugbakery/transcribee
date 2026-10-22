use crate::safetensors_reader::SafetensorsFile;
use burn_tensor::{
    DType::{F16, F32},
    Device, Tensor, TensorCreationOptions,
    activation::{gelu, softmax},
    module::{attention, conv1d, layer_norm, linear},
    ops::{AttentionModuleOptions, ConvOptions},
};
use std::{any::Any, collections::HashMap};

pub struct WeightlessBurnModel {
    safetensors_file: SafetensorsFile,
    initializers: HashMap<String, Box<dyn Any>>, // Burn does not support dynamic rank tensors so we dyn Any here
    device: Device,
}
impl WeightlessBurnModel {
    pub fn new(safetensors_file: SafetensorsFile, device: Device) -> Self {
        Self {
            safetensors_file,
            initializers: HashMap::new(),
            device,
        }
    }

    pub fn maybe_initializer<const D: usize>(
        &mut self,
        key: &str,
        transposed: bool,
    ) -> Option<Tensor<D>> {
        let info = self.safetensors_file.info(key);
        info?;
        if !self.initializers.contains_key(key) {
            let data = self.safetensors_file.burn_tensor(key).unwrap();
            let dtype = data.dtype();
            if D != data.shape().rank() {
                panic!(
                    "wrong rank for key {key} (requested rank {D} but rank is {}",
                    data.shape().rank()
                )
            }
            let tensor: Tensor<D> = Tensor::from_data(
                data,
                TensorCreationOptions::new(self.device.clone()).with_dtype(dtype),
            );
            let tensor = if transposed {
                Tensor::from_data(
                    tensor.transpose().into_data(),
                    TensorCreationOptions::new(self.device.clone()).with_dtype(dtype),
                )
            } else {
                tensor
            };
            self.initializers
                .insert(key.to_string(), Box::new(tensor) as _);
        }

        Some(
            self.initializers
                .get(key)
                .unwrap()
                .downcast_ref::<Tensor<D>>()
                .unwrap()
                .clone(),
        )
    }

    pub fn initializer<const D: usize>(&mut self, key: &str) -> Tensor<D> {
        self.maybe_initializer(key, false).unwrap()
    }

    pub fn conv1d(&mut self, name: &str, x: Tensor<3>, options: ConvOptions<1>) -> Tensor<3> {
        conv1d(
            x,
            self.initializer(&format!("{name}.weight")),
            Some(self.initializer(&format!("{name}.bias"))),
            options,
        )
    }

    pub fn multi_head_attention(&mut self, name: &str, x: Tensor<3>, n_head: usize) -> Tensor<3> {
        let q = self.linear(&format!("{name}.q_proj"), x.clone());
        let k = self.linear(&format!("{name}.k_proj"), x.clone());
        let v = self.linear(&format!("{name}.v_proj"), x);

        let q = q.reshape([0, 0, n_head as i32, -1]).permute([0, 2, 1, 3]);
        let k = k.reshape([0, 0, n_head as i32, -1]).permute([0, 2, 1, 3]);
        let v = v.reshape([0, 0, n_head as i32, -1]).permute([0, 2, 1, 3]);

        let x = if false {
            attention(q, k, v, None, None, AttentionModuleOptions::default())
        } else {
            self.diy_attn(q, k, v)
        };
        let x = x.permute([0, 2, 1, 3]).reshape([0, 0, -1]);

        self.linear(&format!("{name}.out_proj"), x)
    }

    pub fn diy_attn(&mut self, q: Tensor<4>, k: Tensor<4>, v: Tensor<4>) -> Tensor<4> {
        let k = k.transpose();
        let head_dim = q.shape()[3];
        let scale = 1.0 / (head_dim as f32).sqrt();
        softmax((q * scale).matmul(k), -1).matmul(v)
    }

    pub fn layer_norm(&mut self, name: &str, x: Tensor<3>) -> Tensor<3> {
        layer_norm(
            x.cast(F32),
            self.initializer(&format!("{name}.weight")).cast(F32),
            Some(self.initializer(&format!("{name}.bias")).cast(F32)),
            1e-5,
        )
        .cast(F16)
    }

    pub fn residual_attention_block(
        &mut self,
        name: &str,
        x: Tensor<3>,
        n_head: usize,
    ) -> Tensor<3> {
        let ln = self.layer_norm(&format!("{name}.self_attn_layer_norm"), x.clone());
        let x = x + self.multi_head_attention(&format!("{name}.self_attn"), ln, n_head);
        let mlp = self.layer_norm(&format!("{name}.final_layer_norm"), x.clone());
        let mlp = self.linear(&format!("{name}.fc1"), mlp);
        let mlp = gelu(mlp);
        let mlp = self.linear(&format!("{name}.fc2"), mlp);
        x + mlp
    }

    pub fn linear<const D: usize>(&mut self, name: &str, x: Tensor<D>) -> Tensor<D> {
        let weight = self
            .maybe_initializer(&format!("{name}.weight"), true)
            .unwrap();
        let bias = self.maybe_initializer(&format!("{name}.bias"), false);
        linear(x, weight, bias)
    }
}
