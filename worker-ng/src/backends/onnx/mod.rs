use ort::environment::Environment;
use std::sync::LazyLock;

pub mod whisper_decoder;
pub mod whisper_encoder;

pub static ORT_RUNTIME: LazyLock<Environment> =
    LazyLock::new(|| ort::init().with_telemetry(false).build().unwrap());
