use std::collections::HashMap;

use crate::model_downloader::RemoteModel;
use anyhow::{Context, Result, anyhow};
use tokenizers::Tokenizer as HfTokenizer;

pub const WHISPER_V3_LARGE_TOKENIZER_JSON: RemoteModel = RemoteModel {
    url: "https://huggingface.co/openai/whisper-large-v3/resolve/main/tokenizer.json",
    name: "whisper-large-v3-turbo-tokenizer.json",
    size: 2480617,
};

const LANGUAGES: [(&str, &str); 100] = [
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

macro_rules! expose_static_token {
    ($name: ident) => {
        pub fn $name(&self) -> i64 {
            self.tokenizer
                .token_to_id(&format!("<|{}|>", stringify!($name)))
                .unwrap() as i64
        }
    };
}

pub struct Tokenizer {
    tokenizer: HfTokenizer,
    token_to_language: HashMap<u32, &'static str>,
}
impl Tokenizer {
    pub async fn new() -> Result<Self> {
        let tokenizer_file = WHISPER_V3_LARGE_TOKENIZER_JSON
            .ensure_downloaded(|_, _| {})
            .await?;

        let tokenizer = HfTokenizer::from_file(tokenizer_file).unwrap();
        let token_to_language = LANGUAGES
            .iter()
            .map(|(code, _name)| {
                (
                    tokenizer.token_to_id(&format!("<|{code}|>")).unwrap(),
                    *code,
                )
            })
            .collect();

        Ok(Self {
            tokenizer,
            token_to_language,
        })
    }

    expose_static_token!(startoftranscript);
    expose_static_token!(transcribe);
    expose_static_token!(notimestamps);
    expose_static_token!(startofprev);
    expose_static_token!(endoftext);

    pub fn decode_language(&self, token: i64) -> Option<&'static str> {
        self.token_to_language.get(&(token as u32)).cloned()
    }
    pub fn encode_language(&self, code: &str) -> Result<i64> {
        let encoded = self
            .tokenizer
            .token_to_id(&format!("<|{code}|>"))
            .with_context(|| format!("language '{code}' not found"))?;
        Ok(encoded as i64)
    }

    pub fn encode(&self, text: &str) -> Result<Vec<i64>> {
        self.tokenizer
            .encode_fast(text, true)
            .map_err(|e| anyhow!("{e}"))
            .map(|encoding| encoding.get_ids().iter().map(|id| *id as i64).collect())
    }
    pub fn decode(&self, ids: &[i64]) -> Result<String> {
        let ids_u32: Vec<_> = ids.iter().map(|v| *v as u32).collect();
        self.tokenizer
            .decode(&ids_u32, false)
            .map_err(|e| anyhow!("{e}"))
    }

    pub fn sot_sequence(&self, lang: &str) -> Result<Vec<i64>> {
        Ok(vec![
            self.startoftranscript(),
            self.encode_language(lang)?,
            self.transcribe(),
            self.notimestamps(),
        ])
    }
}
