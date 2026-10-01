use anyhow::Result;
use clap::{Arg, Command};

mod audio_reader;
mod model_downloader;
mod stream_processing;
mod whisper;
mod vad;

#[tokio::main]
async fn main() -> Result<()> {
    let m = Command::new("transcribee-worker")
        .arg(Arg::new("in_file").required(true))
        .get_matches();
    let f = m.get_one::<String>("in_file").unwrap();

    println!("{f:?}");
    Ok(())
}
