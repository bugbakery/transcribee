use ort::ep;
use std::fmt::Display;

pub mod decoder;
pub mod encoder;

#[derive(Debug, Clone, Copy)]
pub enum Backend {
    WebGPU,
    CPU,
}
impl Backend {
    pub fn to_ep(&self) -> ep::ExecutionProviderDispatch {
        match self {
            Backend::WebGPU => ep::WebGPU::default().build(),
            Backend::CPU => ep::CPU::default().build(),
        }
    }
}
impl Display for Backend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Backend::WebGPU => f.write_str("WebGPU"),
            Backend::CPU => f.write_str("CPU"),
        }
    }
}
