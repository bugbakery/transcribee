use super::ORT_RUNTIME;
use crate::whisper::encoder::WhisperEncoderBackend;
use anyhow::Result;
use ndarray::{Array2, Axis};
use ort::{
    ep::ExecutionProviderDispatch,
    session::{Session, builder::GraphOptimizationLevel},
    value::Value,
};
use std::path::Path;
use tracing::{Level, instrument};

#[derive(Debug)]
pub struct WhisperEncoderOrt {
    model: Session,
}
impl WhisperEncoderOrt {
    pub fn new(backend: ExecutionProviderDispatch, model_path: &str) -> Result<Self> {
        let model = Session::builder(&ORT_RUNTIME)?
            .with_execution_providers([backend.clone()])
            .unwrap()
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap()
            .with_config_entry(
                "session.model_external_initializers_file_folder_path",
                Path::new(model_path).parent().unwrap().to_str().unwrap(),
            )
            .unwrap()
            .with_config_entry(
                "session.model_external_initializers_file_folder_path",
                Path::new(model_path).parent().unwrap().to_str().unwrap(),
            )
            .unwrap()
            .commit_from_memory(include_bytes!(
                "./models/whisper_large_v3_turbo_encoder.onnx"
            ))?;

        Ok(Self { model })
    }
}
impl WhisperEncoderBackend for WhisperEncoderOrt {
    #[instrument(level = Level::TRACE, skip(mel))]
    fn encode(&mut self, mel: Array2<f32>) -> Result<Array2<f32>> {
        let outputs: ort::session::SessionOutputs<'_> = self
            .model
            .run([Value::from_array(mel.insert_axis(Axis(0)))?.into()])?;
        let (_, output) = outputs["last_hidden_state"].try_extract_tensor::<f32>()?;
        let output_arr = Array2::from_shape_vec((1500, 1280), output.to_vec()).unwrap();
        Ok(output_arr)
    }
}
