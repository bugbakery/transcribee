use anyhow::{Context, Ok, Result, bail};
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom::Start},
    os::raw::c_void,
    str::FromStr,
};

#[derive(Debug)]
pub struct SafetensorsFile {
    file: File,
    tensors: HashMap<String, TensorInfo>,
}
impl SafetensorsFile {
    pub fn new(path: &str) -> Result<Self> {
        let mut file = File::open(path)?;
        let mut header_len = [0u8; 8];
        file.read_exact(&mut header_len)?;
        let header_len = u64::from_le_bytes(header_len);
        let mut header = vec![0u8; header_len as usize];
        file.read_exact(&mut header)?;
        let header = String::from_utf8(header)?;
        let mut header = json::parse(&header)?;

        let mut tensors = HashMap::new();
        for (k, v) in header.entries_mut() {
            if k == "__metadata__" {
                continue;
            }
            let dtype = TensorDataType::from_str(
                v.remove("dtype")
                    .as_str()
                    .with_context(|| format!("dtype of {k} is not a string or missing"))?,
            )?;

            let shape = v
                .remove("shape")
                .members()
                .map(|dim| dim.as_usize())
                .collect::<Option<Vec<usize>>>()
                .with_context(|| format!("shape of {k} is not numbers"))?;
            let data_offsets = v
                .remove("data_offsets")
                .members()
                .map(|dim| dim.as_u64())
                .collect::<Option<Vec<u64>>>()
                .with_context(|| format!("data_offsets of {k} is not numbers"))?;
            let offset = data_offsets[0] + header_len + 8;
            let length = data_offsets[1] - data_offsets[0];

            let ti = TensorInfo {
                dtype,
                shape,
                offset,
                length,
            };
            tensors.insert(k.to_string(), ti);
        }

        Ok(Self { file, tensors })
    }

    pub fn info(&mut self, name: &str) -> Option<&TensorInfo> {
        self.tensors.get(name)
    }

    pub fn burn_tensor(&mut self, name: &str) -> Result<burn_tensor::TensorData> {
        let info = self
            .info(name)
            .with_context(|| format!("no tensor named {name}"))?;
        let mut bytes = vec![0u8; info.length as usize];
        let offset = info.offset;
        let dtype = info.dtype.as_burn_dtype();
        let shape: Vec<i32> = info.shape.iter().map(|x| *x as i32).collect();
        self.file.seek(Start(offset))?;
        self.file.read_exact(&mut bytes)?;
        Ok(burn_tensor::TensorData::from_bytes_vec(bytes, shape, dtype))
    }

    pub fn mlx_array(&mut self, name: &str) -> Result<mlx_rs::Array> {
        let info = self
            .info(name)
            .with_context(|| format!("no tensor named {name}"))?;
        let mut bytes = vec![0u8; info.length as usize];
        let offset = info.offset;
        let dtype = info.dtype.as_mlx_dtype();
        let shape: Vec<i32> = info.shape.iter().map(|x| *x as i32).collect();
        self.file.seek(Start(offset))?;
        self.file.read_exact(&mut bytes)?;
        // TODO: is this use after free?
        Ok(unsafe { mlx_rs::Array::from_raw_data(bytes.as_ptr() as *const c_void, &shape, dtype) })
    }
}

#[derive(Debug, Clone)]
pub struct TensorInfo {
    dtype: TensorDataType,
    shape: Vec<usize>,
    offset: u64,
    length: u64,
}

#[derive(Debug, Clone, Copy)]
enum TensorDataType {
    F16,
}
impl TensorDataType {
    fn as_burn_dtype(&self) -> burn_tensor::DType {
        match self {
            TensorDataType::F16 => burn_tensor::DType::F16,
        }
    }
    fn as_mlx_dtype(&self) -> mlx_rs::Dtype {
        match self {
            TensorDataType::F16 => mlx_rs::Dtype::Float16,
        }
    }
}
impl FromStr for TensorDataType {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "F16" => Ok(Self::F16),
            _ => bail!("could not parse dtype '{}'", s),
        }
    }
}
