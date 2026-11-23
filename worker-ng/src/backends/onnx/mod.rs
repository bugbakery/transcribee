use ort::environment::Environment;
use std::sync::LazyLock;
use ort::device::Device;
use ort::AsPointer;

pub mod whisper_decoder;
pub mod whisper_encoder;

pub static ORT_RUNTIME: LazyLock<Environment> = LazyLock::new(|| {
    let env = ort::init().with_telemetry(false).build().unwrap();

    match std::env::var("ORT_DYLIB_PATH") {
        Ok(s) if !s.is_empty() => {
            let path: std::path::PathBuf = s.into();
            let path = path.parent().unwrap().to_path_buf();
            for provider in ["openvino", "webgpu"] {
                let mut path = path.clone();
                path.push(format!(
                    "{}onnxruntime_providers_{}{}",
                    std::env::consts::DLL_PREFIX,
                    provider,
                    std::env::consts::DLL_SUFFIX
                ));
                env.register_ep_library(provider, path).unwrap()
            }
        }
        _ => {}
    }

    env
});

fn ensure_with_cpu<'a>(device: &Device<'a>) -> Vec<Device<'a>> {
    let device = ORT_RUNTIME
        .devices()
        .find(|d| d.ptr() == device.ptr())
        .unwrap();
    let cpu_device = ORT_RUNTIME
        .devices()
        .find(|d| d.ep().unwrap() == "CPUExecutionProvider")
        .unwrap();
    if device.ptr() == cpu_device.ptr() {
        vec![device]
    } else {
        vec![device, cpu_device]
    }
}
