use std::time::Instant;

use anyhow::{Ok, Result};
use clap::{Arg, Command};
use indicatif::ProgressBar;
use ndarray::Array2;

use crate::{
    audio_reader::AudioReader,
    model_downloader::RemoteModel,
    whisper::{decoder, decoder_loop::Whisper, encoder},
};

mod audio_reader;
mod model_downloader;
mod safetensors_reader;
mod vad;
mod whisper;

const WHISPER_LARGE_V3_TURBO: RemoteModel = RemoteModel {
    url: "https://huggingface.co/openai/whisper-large-v3-turbo/resolve/main/model.safetensors",
    name: "whisper_large_v3_turbo.safetensors",
    size: 1617824864,
};

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();

    let m = Command::new("transcribee-worker")
        .subcommand(
            Command::new("benchmark").about("benchmark the available backends on this system"),
        )
        .subcommand(
            Command::new("transcribe")
                .about("transcribe an audio file")
                .arg(Arg::new("in_file").required(true)),
        )
        .get_matches();

    if let Some(_) = m.subcommand_matches("benchmark") {
        WHISPER_LARGE_V3_TURBO.ensure_download_or_mock()?;

        for (name, backend) in encoder::get_backends("target/") {
            let mut backend = backend().unwrap();
            println!("benchmarking {}...", name);
            let (min, mean, max) = benchmark(10, || {
                let dummy_data = Array2::zeros((128, 3000));
                backend.encode(dummy_data).unwrap();
            });
            println!("-> encode() min={min} mean={mean} max={max}");
        }
        for mut backend in decoder::get_backends("target/") {
            println!("benchmarking {}...", backend.name());
            let mut chunk = None;
            let (min, mean, max) = benchmark(10, || {
                let dummy_data = Array2::zeros((1500, 1280));
                chunk = Some(
                    backend
                        .register_encoded_audio_chunks(&[dummy_data])
                        .unwrap(),
                );
            });
            println!(
                "-> register_encoded_audio_chunks() \t min={min:.1} mean={mean:.1} max={max:.1}"
            );
            let chunk = chunk.unwrap().remove(0);
            for batch in [1, 2, 3, 4] {
                for len in [100, 200] {
                    let seq = backend.register_sequence(&vec![0i64; len]);
                    let (min, mean, max) = benchmark(10, || {
                        backend
                            .forward(&vec![(chunk.clone(), seq.clone()); batch])
                            .unwrap();
                    });
                    println!(
                        "-> prefill {len} tokens batch {batch} \t\t min={min:.1} mean={mean:.1} max={max:.1}"
                    );
                }
            }
        }
    } else if let Some(matches) = m.subcommand_matches("transcribe") {
        let pb = ProgressBar::new(0);
        WHISPER_LARGE_V3_TURBO
            .ensure_downloaded(|done, total| {
                pb.set_position(done);
                pb.set_length(total)
            })
            .await?;

        let f = matches.get_one::<String>("in_file").unwrap();

        let ar = AudioReader::new(f)?;

        // todo: store benchmark somewhere and pick the fastest
        let encoder = encoder::get_backends("target/").remove(0).1().unwrap();
        let decoder = decoder::get_backends("target/").remove(0);
        let mut whisper = Whisper::new(encoder, decoder).await?;

        whisper.transcribe(&ar, &mut |bar| {
            let text: String = bar.atoms.iter().map(|atom| &atom.text as &str).collect();
            println!("{text}")
        })?;
    }

    Ok(())
}

fn benchmark(n: usize, mut work: impl FnMut()) -> (f32, f32, f32) {
    let mut times: Vec<f32> = (0..n)
        .map(|_| {
            let start = Instant::now();
            work();
            start.elapsed().as_secs_f32()
        })
        .collect();
    times.remove(0); // first run is warmup
    let min = *times.iter().min_by(|a, b| a.total_cmp(b)).unwrap();
    let mean = times.iter().sum::<f32>() / times.len() as f32;
    let max = *times.iter().max_by(|a, b| a.total_cmp(b)).unwrap();
    (min * 1000., mean * 1000., max * 1000.)
}
