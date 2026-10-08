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
    let m = Command::new("transcribee-worker")
        .arg(Arg::new("in_file").required(true))
        .get_matches();
    let f = m.get_one::<String>("in_file").unwrap();

    let ar = AudioReader::new(f).unwrap();
    let mut whisper = Whisper::new().await.unwrap();

    dbg!(whisper.transcribe(&ar, &mut |_| {}).await.unwrap());

    Ok(())
}
