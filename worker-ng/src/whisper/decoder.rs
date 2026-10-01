use std::{collections::{HashMap}, time::Instant};
use crate::{model_downloader::RemoteModel};
use super::encoder::WhisperEncoderOrt;
use anyhow::Result;
use compute::functions::softmax;
use ndarray::{Array2, ArrayD};
use ort::{
    session::{Session, builder::GraphOptimizationLevel},
    value::Value,
};
use tokenizers::Tokenizer;

const LANGUAGES: [(&'static str, &'static str); 100] = [
    ("en", "english"),
    ("zh", "chinese"),
    ("de", "german"),
    ("es", "spanish"),
    ("ru", "russian"),
    ("ko", "korean"),
    ("fr", "french"),
    ("ja", "japanese"),
    ("pt", "portuguese"),
    ("tr", "turkish"),
    ("pl", "polish"),
    ("ca", "catalan"),
    ("nl", "dutch"),
    ("ar", "arabic"),
    ("sv", "swedish"),
    ("it", "italian"),
    ("id", "indonesian"),
    ("hi", "hindi"),
    ("fi", "finnish"),
    ("vi", "vietnamese"),
    ("he", "hebrew"),
    ("uk", "ukrainian"),
    ("el", "greek"),
    ("ms", "malay"),
    ("cs", "czech"),
    ("ro", "romanian"),
    ("da", "danish"),
    ("hu", "hungarian"),
    ("ta", "tamil"),
    ("no", "norwegian"),
    ("th", "thai"),
    ("ur", "urdu"),
    ("hr", "croatian"),
    ("bg", "bulgarian"),
    ("lt", "lithuanian"),
    ("la", "latin"),
    ("mi", "maori"),
    ("ml", "malayalam"),
    ("cy", "welsh"),
    ("sk", "slovak"),
    ("te", "telugu"),
    ("fa", "persian"),
    ("lv", "latvian"),
    ("bn", "bengali"),
    ("sr", "serbian"),
    ("az", "azerbaijani"),
    ("sl", "slovenian"),
    ("kn", "kannada"),
    ("et", "estonian"),
    ("mk", "macedonian"),
    ("br", "breton"),
    ("eu", "basque"),
    ("is", "icelandic"),
    ("hy", "armenian"),
    ("ne", "nepali"),
    ("mn", "mongolian"),
    ("bs", "bosnian"),
    ("kk", "kazakh"),
    ("sq", "albanian"),
    ("sw", "swahili"),
    ("gl", "galician"),
    ("mr", "marathi"),
    ("pa", "punjabi"),
    ("si", "sinhala"),
    ("km", "khmer"),
    ("sn", "shona"),
    ("yo", "yoruba"),
    ("so", "somali"),
    ("af", "afrikaans"),
    ("oc", "occitan"),
    ("ka", "georgian"),
    ("be", "belarusian"),
    ("tg", "tajik"),
    ("sd", "sindhi"),
    ("gu", "gujarati"),
    ("am", "amharic"),
    ("yi", "yiddish"),
    ("lo", "lao"),
    ("uz", "uzbek"),
    ("fo", "faroese"),
    ("ht", "haitian creole"),
    ("ps", "pashto"),
    ("tk", "turkmen"),
    ("nn", "nynorsk"),
    ("mt", "maltese"),
    ("sa", "sanskrit"),
    ("lb", "luxembourgish"),
    ("my", "myanmar"),
    ("bo", "tibetan"),
    ("tl", "tagalog"),
    ("mg", "malagasy"),
    ("as", "assamese"),
    ("tt", "tatar"),
    ("haw", "hawaiian"),
    ("ln", "lingala"),
    ("ha", "hausa"),
    ("ba", "bashkir"),
    ("jw", "javanese"),
    ("su", "sundanese"),
    ("yue", "cantonese"),
];

pub const WHISPER_V3_LARGE_DECODER: RemoteModel = RemoteModel {
    url: "https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/onnx/decoder_model_fp16.onnx",
    name: "whisper-large-v3-turbo-decoder.onnx",
    size: 344003183,
};
// TODO: add back kv-caching
// pub const WHISPER_V3_LARGE_DECODER: RemoteModel = RemoteModel {
//     url: "https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/onnx/decoder_with_past_model_fp16.onnx",
//     name: "whisper-large-v3-turbo-decoder.onnx",
//     size: 317771757,
// };
pub const WHISPER_V3_LARGE_TOKENIZER_JSON: RemoteModel = RemoteModel {
    url: "https://huggingface.co/openai/whisper-large-v3/resolve/main/tokenizer.json",
    name: "whisper-large-v3-turbo-tokenizer.json",
    size: 2480617,
};

pub struct WhisperDecoderOrt {
    encoder: WhisperEncoderOrt,
    model: Session,
    tokenizer: Tokenizer,
}

impl WhisperDecoderOrt {
    pub async fn new(encoder: WhisperEncoderOrt) -> Result<Self> {
        let tokenizer_file = WHISPER_V3_LARGE_TOKENIZER_JSON
            .ensure_downloaded(|_, _| {})
            .await?;
        let tokenizer = Tokenizer::from_file(tokenizer_file).unwrap();
        let model_path = WHISPER_V3_LARGE_DECODER
            .ensure_downloaded(|_done, _total| {})
            .await?;
        let model = Session::builder()?
            // we cannot use concurrent WebGPU EPs currently due to an upstream bug
            // https://github.com/microsoft/onnxruntime/issues/31627
            //.with_execution_providers([ep::WebGPU::default().build()])
            //.unwrap()
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap()
            .commit_from_file(model_path)?;

        Ok(Self {
            encoder,
            tokenizer,
            model,
        })
    }

    pub async fn detect_language(&mut self) -> Result<&'static str> {
        let encoded = self.encoder.get(0..self.encoder.len().min(16_000 * 30))?;

        let mut input_ids = Array2::<i64>::default((1, 1));
        let sot = self
            .tokenizer
            .token_to_id(&"<|startoftranscript|>")
            .unwrap();
        *input_ids.get_mut((0, 0)).unwrap() = sot as i64;

        let start = Instant::now();
        let outputs: ort::session::SessionOutputs<'_> = self.model.run([
            Value::from_array(input_ids)?.into(),
            Value::from_array(encoded)?.into(),
        ])?;
        let (shape, data) = outputs["logits"].try_extract_tensor::<f32>().unwrap();
        let logits = ArrayD::from_shape_vec(
            shape.iter().map(|x| *x as usize).collect::<Vec<_>>(),
            data.to_vec(),
        )?;
        let duration = start.elapsed();
        println!("forward pass of decoder took {}s", duration.as_secs_f32());
        let tokens_to_language: HashMap<u32, &str> = LANGUAGES
            .iter()
            .map(|(code, _name)| (
                self.tokenizer.token_to_id(&format!("<|{code}|>")).unwrap(),
                *code,
            ))
            .collect();
        let batch = logits.outer_iter().next().unwrap();
        let token = batch.outer_iter().next().unwrap();
        let (languages, logits): (Vec<&str>, Vec<f64>) = token
            .iter()
            .enumerate()
            .filter_map(|(i, logit)| tokens_to_language.get(&(i as u32)).map(|lang| (lang, *logit as f64)))
            .collect();

        let probs = softmax(&logits);
        let mut result: Vec<_> = probs.iter().zip(languages).collect();
        result.sort_by(|(x, _), (y, _)| x.total_cmp(y));
        for (prob, lang) in result {
            println!("{lang} {prob}");
        }


        unreachable!()
    }

    pub async fn transcribe(&mut self) -> Result<()> {
        unimplemented!()
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::audio_reader::AudioReader;

    #[tokio::test]
    async fn test_benchmark() {
        let ar = AudioReader::new("../worker/tests/data/sample.mp3").unwrap();
        let encoder = WhisperEncoderOrt::new(ar).await.unwrap();
        let mut decoder = WhisperDecoderOrt::new(encoder).await.unwrap();
        let lang = decoder.detect_language().await.unwrap();
        println!("{lang}");
    }
}
