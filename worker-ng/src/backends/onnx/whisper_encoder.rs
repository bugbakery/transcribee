use super::ORT_RUNTIME;
use crate::whisper::encoder::WhisperEncoderBackend;
use anyhow::Result;
use log::info;
use ndarray::{Array2, Axis};
use ort::{
    ep::ExecutionProviderDispatch,
    session::{Session, builder::GraphOptimizationLevel},
    value::Value,
};
use std::{path::Path, time::Instant};

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
            .commit_from_file(model_path)?;

        Ok(Self { model })
    }
}
impl WhisperEncoderBackend for WhisperEncoderOrt {
    fn encode(&mut self, mel: Array2<f32>) -> Result<Array2<f32>> {
        let start = Instant::now();
        let outputs: ort::session::SessionOutputs<'_> = self
            .model
            .run([Value::from_array(mel.insert_axis(Axis(0)))?.into()])?;
        let (_, output) = outputs["last_hidden_state"].try_extract_tensor::<f32>()?;
        let output_arr = Array2::from_shape_vec((1500, 1280), output.to_vec()).unwrap();
        info!("encoder took: {:?}", start.elapsed());
        Ok(output_arr)
    }
}
