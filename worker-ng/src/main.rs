use anyhow::Result;
use clap::{Arg, Command};

mod audio_reader;
mod earshot_vad;
mod model_downloader;
mod silero_vad;
mod stream_processing;
mod transcription_restart;
mod whisper;

#[tokio::main]
async fn main() -> Result<()> {
    let m = Command::new("transcribee-worker")
        .arg(Arg::new("in_file").required(true))
        .get_matches();
    let f = m.get_one::<String>("in_file").unwrap();

    println!("{f:?}");

    Ok(())
}
