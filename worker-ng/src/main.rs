use anyhow::Result;
use clap::{Arg, Command};

use crate::{audio_reader::AudioReader, whisper::decoder_loop::Whisper};

mod audio_reader;
mod model_downloader;
mod stream_processing;
mod util;
mod vad;
mod whisper;

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();

    let m = Command::new("transcribee-worker")
        .arg(Arg::new("in_file").required(true))
        .get_matches();
    let f = m.get_one::<String>("in_file").unwrap();

    let ar = AudioReader::new(f)?;
    let mut whisper = Whisper::new().await?;

    whisper.transcribe(&ar, &mut |bar| {
        let text: String = bar.atoms.iter().map(|atom| &atom.text as &str).collect();
        println!("{text}")
    })?;

    Ok(())
}
