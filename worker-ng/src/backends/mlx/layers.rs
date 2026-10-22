use mlx_rs::{Array, fast, nn, ops};
use std::collections::HashMap;

use crate::safetensors_reader::SafetensorsFile;

pub struct WeightlessMLXModel {
    safetensors_file: SafetensorsFile,
    initializers: HashMap<String, Array>,
}
impl WeightlessMLXModel {
    pub fn new(safetensors_file: SafetensorsFile) -> Self {
        Self {
            safetensors_file,
            initializers: HashMap::new(),
        }
    }

    pub fn maybe_initializer(&mut self, key: &str, transpose: Option<&[i32]>) -> Option<Array> {
        let info = self.safetensors_file.info(key);
        info?;
        if !self.initializers.contains_key(key) {
            let array = self.safetensors_file.mlx_array(key).unwrap();
            let array = match transpose {
                Some(transpose) => array.transpose_axes(transpose).unwrap(),
                None => array,
            };
            array.eval().unwrap();
            self.initializers.insert(key.to_string(), array);
        }

        Some(self.initializers.get(key).unwrap().clone())
    }

    pub fn initializer(&mut self, key: &str) -> Array {
        self.maybe_initializer(key, None).unwrap()
    }

    // we wrap gelu because the default mlx gelu always converts to f32 which makes everything go slow
    pub fn gelu(x: Array) -> Array {
        let dtype = x.dtype();
        nn::gelu(x).unwrap().as_dtype(dtype).unwrap()
    }

    pub fn conv1d(
        &mut self,
        name: &str,
        x: Array,
        stride: Option<i32>,
        padding: Option<i32>,
    ) -> Array {
        ops::conv1d(
            x,
            self.maybe_initializer(&format!("{name}.weight"), Some(&[0, 2, 1]))
                .unwrap(),
            stride,
            padding,
            None,
            None,
        )
        .unwrap()
            + self.initializer(&format!("{name}.bias"))
    }

    pub fn multi_head_attention(&mut self, name: &str, x: Array, n_head: usize) -> Array {
        let q = self.linear(&format!("{name}.q_proj"), x.clone());
        let k = self.linear(&format!("{name}.k_proj"), x.clone());
        let v = self.linear(&format!("{name}.v_proj"), x);

        let q = q
            .reshape(&[q.shape()[0], q.shape()[1], n_head as i32, -1])
            .unwrap()
            .transpose_axes(&[0, 2, 1, 3])
            .unwrap();
        let k = k
            .reshape(&[k.shape()[0], k.shape()[1], n_head as i32, -1])
            .unwrap()
            .transpose_axes(&[0, 2, 1, 3])
            .unwrap();
        let v = v
            .reshape(&[v.shape()[0], v.shape()[1], n_head as i32, -1])
            .unwrap()
            .transpose_axes(&[0, 2, 1, 3])
            .unwrap();

        let x = if true {
            let head_dim = q.shape()[3];
            let scale = 1.0 / (head_dim as f32).sqrt();
            fast::scaled_dot_product_attention(q, k, v, scale, None, None).unwrap()
        } else {
            self.diy_attn(q, k, v)
        };

        let x = x.transpose_axes(&[0, 2, 1, 3]).unwrap();
        let x = x.reshape(&[x.shape()[0], x.shape()[1], -1]).unwrap();

        self.linear(&format!("{name}.out_proj"), x)
    }

    pub fn diy_attn(&mut self, q: Array, k: Array, v: Array) -> Array {
        let k = k.transpose_axes(&[0, 1, 3, 2]).unwrap();
        let head_dim = q.shape()[3];
        let scale = 1.0 / (head_dim as f32).sqrt();
        let w = ops::softmax_axes((q * scale).matmul(k).unwrap(), &[-1], Some(true)).unwrap();
        w.matmul(v).unwrap()
    }

    pub fn layer_norm(&mut self, name: &str, x: Array) -> Array {
        fast::layer_norm(
            x,
            Some(&self.initializer(&format!("{name}.weight"))),
            Some(&self.initializer(&format!("{name}.bias"))),
            1e-5,
        )
        .unwrap()
    }

    pub fn residual_attention_block(&mut self, name: &str, x: Array, n_head: usize) -> Array {
        let ln = self.layer_norm(&format!("{name}.self_attn_layer_norm"), x.clone());
        let x = x + self.multi_head_attention(&format!("{name}.self_attn"), ln, n_head);

        let mlp = self.layer_norm(&format!("{name}.final_layer_norm"), x.clone());
        let mlp = self.linear(&format!("{name}.fc1"), mlp);
        let mlp = Self::gelu(mlp);
        let mlp = self.linear(&format!("{name}.fc2"), mlp);

        x + mlp
    }

    pub fn linear(&mut self, name: &str, x: Array) -> Array {
        let weight = self
            .maybe_initializer(&format!("{name}.weight"), Some(&[1, 0]))
            .unwrap();
        let bias = self.maybe_initializer(&format!("{name}.bias"), None);
        let x = x.matmul(weight).unwrap();
        if let Some(bias) = bias { x + bias } else { x }
    }
}
