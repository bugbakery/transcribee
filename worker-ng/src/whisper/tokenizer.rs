use crate::model_downloader::RemoteModel;
use anyhow::{Result, anyhow, bail};
use ndarray::Array1;
use std::sync::Mutex;
use tokenizers::Tokenizer as HfTokenizer;

pub const WHISPER_V3_LARGE_TOKENIZER_JSON: RemoteModel = RemoteModel {
    url: "https://huggingface.co/openai/whisper-large-v3/resolve/main/tokenizer.json",
    name: "whisper-large-v3-turbo-tokenizer.json",
    size: 2480617,
};
pub const NUM_TOKENS: usize = 51866;

pub const LANGUAGES: [(&str, &str); 100] = [
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
    non_speech_tokens_mask: Mutex<Option<Array1<f32>>>,
    special_tokens_mask: Mutex<Option<Array1<f32>>>,
}
impl Tokenizer {
    pub async fn new() -> Result<Self> {
        let tokenizer_file = WHISPER_V3_LARGE_TOKENIZER_JSON
            .ensure_downloaded(|_, _| {})
            .await?;

        let tokenizer = HfTokenizer::from_file(tokenizer_file).unwrap();
        Ok(Self {
            tokenizer,
            non_speech_tokens_mask: Mutex::new(None),
            special_tokens_mask: Mutex::new(None),
        })
    }

    expose_static_token!(startoftranscript);
    expose_static_token!(transcribe);
    expose_static_token!(notimestamps);
    expose_static_token!(startofprev);
    expose_static_token!(endoftext);
    expose_static_token!(nospeech);

    pub fn encode(&self, text: &str) -> Result<Vec<i64>> {
        self.tokenizer
            .encode_fast(text, false)
            .map_err(|e| anyhow!("{e}"))
            .map(|encoding| encoding.get_ids().iter().map(|id| *id as i64).collect())
    }
    pub fn decode(&self, ids: &[i64]) -> Result<String> {
        let ids_u32: Vec<_> = ids.iter().map(|v| *v as u32).collect();
        self.tokenizer
            .decode(&ids_u32, false)
            .map_err(|e| anyhow!("{e}"))
    }

    pub fn encode_single(&self, text: &str) -> Result<i64> {
        let x = self.tokenizer.token_to_id(&text.replace(" ", "Ġ"));
        if x.is_none() {
            bail!("expected '{text}' to encode to one token but it encoded to {x:?}")
        } else {
            Ok(x.unwrap() as i64)
        }
    }
    pub fn decode_single(&self, id: i64) -> Result<String> {
        self.decode(&[id])
    }

    pub fn sot_sequence(&self, lang: &str) -> Result<Vec<i64>> {
        Ok(vec![
            self.startoftranscript(),
            self.encode_single(&format!("<|{lang}|>"))?,
            self.transcribe(),
            self.notimestamps(),
        ])
    }

    pub fn generate_mask(&self, include_token: impl Fn(i64) -> bool) -> Array1<f32> {
        Array1::from_iter((0..NUM_TOKENS).map(|t| {
            if include_token(t as i64) {
                0.0
            } else {
                f32::NEG_INFINITY
            }
        }))
    }

    pub fn special_tokens_mask(&self, allow: &[i64]) -> Array1<f32> {
        let mut locked = self.special_tokens_mask.lock().unwrap();
        if locked.is_none() {
            let mask = self.generate_mask(|t| !self.decode_single(t).unwrap().contains("<|"));
            locked.replace(mask);
        }
        let mut to_return = locked.as_ref().unwrap().clone();
        for t in allow {
            to_return[*t as usize] = 0.0;
        }
        to_return
    }

    pub fn non_speech_tokens_mask(&self) -> Array1<f32> {
        let mut locked = self.non_speech_tokens_mask.lock().unwrap();
        if locked.is_none() {
            let supress = "\" # ( ) * + / : ; < = > @ [ \\ ] ^ _ ` { | } ~ 「 」 『 << >> <<< >>> -- --- -( -[ (' (\" (( )) ((( ))) [[ ]] {{ }}";

            let mut mask = self.generate_mask(|t| {
                let decoded = self.decode_single(t).unwrap();
                !supress.split(" ").any(|supress| decoded.contains(supress))
                    || decoded.contains("<|")
            });

            mask[self.encode_single(" -").unwrap() as usize] = f32::NEG_INFINITY;
            mask[self.encode_single(" '").unwrap() as usize] = f32::NEG_INFINITY;

            locked.replace(mask);
        }
        locked.as_ref().unwrap().clone()
    }
}
