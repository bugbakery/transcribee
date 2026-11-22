use crate::benchmark::{benchmark_whisper, get_system_string};
use crate::transcribee_worker::run_worker;
use crate::whisper::tokenizer::Tokenizer;
use crate::{
    audio_reader::AudioReader,
    model_downloader::RemoteModel,
    whisper::{decoder, decoder_loop::WhisperModel, encoder},
};
use anyhow::{Ok, Result};
use clap::{Arg, Command};
use indicatif::ProgressBar;
use std::fs::File;
use std::io::Write;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod audio_reader;
mod backends;
mod benchmark;
mod model_downloader;
mod safetensors_reader;
mod transcribee_api_client;
mod transcribee_worker;
mod vad;
mod whisper;

const WHISPER_LARGE_V3_TURBO: RemoteModel = RemoteModel {
    url: "https://huggingface.co/openai/whisper-large-v3-turbo/resolve/main/model.safetensors",
    name: "whisper_large_v3_turbo.safetensors",
    size: 1617824864,
};

#[tokio::main]
async fn main() -> Result<()> {
    #[cfg(feature = "debug-logging")]
    tracing_subscriber::registry()
        .with(venator::Venator::default())
        .with(tracing_perfetto::PerfettoLayer::new(std::sync::Mutex::new(
            std::fs::File::create("target/trace.pftrace").unwrap(),
        )))
        .init();

    #[cfg(not(feature = "debug-logging"))]
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .or_else(|_| tracing_subscriber::EnvFilter::try_new("ort=warn,info"))
                .unwrap(),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let m = Command::new("transcribee-worker")
        .subcommand(Command::new("sysinfo"))
        .subcommand(
            Command::new("benchmark").about("benchmark the available backends on this system"),
        )
        .subcommand(
            Command::new("work")
                .about("work as a transcribee worker")
                .arg(Arg::new("coordinator").long("coordinator").required(true))
                .arg(Arg::new("token").long("token").required(true)),
        )
        .subcommand(
            Command::new("transcribe")
                .about("transcribe an audio file")
                .arg(Arg::new("in_file").required(true)),
        )
        .get_matches();

    let pb = ProgressBar::new(0).with_message("downloading whisper model");
    WHISPER_LARGE_V3_TURBO
        .ensure_downloaded(|done, total| {
            pb.set_position(done);
            pb.set_length(total)
        })
        .await?;

    if m.subcommand_matches("sysinfo").is_some() {
        println!("{}", get_system_string());
    } else if m.subcommand_matches("benchmark").is_some() {
        benchmark_whisper().await?
    } else if let Some(matches) = m.subcommand_matches("work") {
        let base_url = matches.get_one::<String>("coordinator").unwrap();
        let token = matches.get_one::<String>("token").unwrap();
        run_worker(base_url, token).await?;
    } else if let Some(matches) = m.subcommand_matches("transcribe") {
        let f = matches.get_one::<String>("in_file").unwrap();
        let ar = AudioReader::new(f)?;

        // todo: store benchmark somewhere and pick the fastest
        let encoder = encoder::get_backends("target/").remove(0).1().unwrap();
        let decoder = decoder::get_backends("target/").remove(0).1().unwrap();
        let tokenizer = Tokenizer::new().await?;
        let mut whisper = WhisperModel::new(encoder, decoder, tokenizer, 5)?;

        let mut i = 0;
        let mut file = File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open("target/transcript.json")?;
        whisper
            .new_session(ar, None)
            .with_new_bar_listener(move |bar| {
                println!("{i}: {}", bar.as_string());
                writeln!(&mut file, "{}", bar.as_json()).unwrap();
                i += 1;
            })
            .transcribe()?;
    }
    Ok(())
}
