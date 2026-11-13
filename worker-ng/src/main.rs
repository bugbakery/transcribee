use anyhow::{Ok, Result};
use clap::{Arg, Command};
use indicatif::ProgressBar;
use ndarray::Array2;
use std::io::Write;
use std::{fs::File, time::Instant};
use tracing_perfetto::PerfettoLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::{
    audio_reader::AudioReader,
    model_downloader::RemoteModel,
    whisper::{decoder, decoder_loop::Whisper, encoder},
};

mod audio_reader;
mod backends;
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
    let layer = PerfettoLayer::new(std::sync::Mutex::new(
        std::fs::File::create("target/trace.pftrace").unwrap(),
    ));
    let filter_layer = tracing_subscriber::EnvFilter::try_from_default_env()
        .or_else(|_| tracing_subscriber::EnvFilter::try_new("info"))
        .unwrap();
    tracing_subscriber::registry()
        .with(venator::Venator::default())
        //.with(filter_layer)
        .with(layer)
        .init();

    let m = Command::new("transcribee-worker")
        .subcommand(
            Command::new("benchmark").about("benchmark the available backends on this system"),
        )
        .subcommand(
            Command::new("transcribe")
                .about("transcribe an audio file")
                .arg(Arg::new("in_file").required(true)),
        )
        .subcommand(Command::new("sysinfo"))
        .get_matches();

    let pb = ProgressBar::new(0);
    WHISPER_LARGE_V3_TURBO
        .ensure_downloaded(|done, total| {
            pb.set_position(done);
            pb.set_length(total)
        })
        .await?;

    if m.subcommand_matches("benchmark").is_some() {
        for (name, backend) in decoder::get_backends("target/") {
            let mut backend = backend().unwrap();
            println!("benchmarking {}...", name);
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
                "-> register_encoded_audio_chunks \t min={min:.1} mean={mean:.1} max={max:.1}"
            );
            report_benchmark_result(name, "register_encoded_audio_chunks", mean).await?;
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
                    report_benchmark_result(
                        name,
                        &format!("prefill {len} tokens batch {batch}"),
                        mean,
                    )
                    .await?;
                }
            }

            for batch in [1, 5, 10, 20] {
                let seq = backend.register_sequence(&vec![0i64; 100]);
                let (min, mean, max) = benchmark_with_setup(10, || {
                    backend
                        .forward(&vec![(chunk.clone(), seq.clone()); 1])
                        .unwrap();
                    let start = Instant::now();
                    for _ in 0..10 {
                        //seq = backend.append_token_to_sequence(&seq, 0, 1.0).unwrap();
                        backend
                            .forward(&vec![(chunk.clone(), seq.clone()); batch])
                            .unwrap();
                    }
                    start.elapsed().as_secs_f32()
                });
                println!(
                    "-> decode 10 tokens batch {batch} (context=100) \t\t min={min:.1} mean={mean:.1} max={max:.1}"
                );
                report_benchmark_result(
                    name,
                    &format!("decode 10 tokens batch {batch} (context=100)"),
                    mean,
                )
                .await?;
            }
        }

        for (name, backend) in encoder::get_backends("target/") {
            let mut backend = backend().unwrap();
            println!("benchmarking {}...", name);
            let (min, mean, max) = benchmark(10, || {
                let dummy_data = Array2::zeros((128, 3000));
                backend.encode(dummy_data).unwrap();
            });
            println!("-> encode() min={min} mean={mean} max={max}");
            report_benchmark_result(name, &format!("encode"), mean).await?;
        }
    } else if let Some(matches) = m.subcommand_matches("transcribe") {
        let f = matches.get_one::<String>("in_file").unwrap();

        let ar = AudioReader::new(f)?;

        // todo: store benchmark somewhere and pick the fastest
        let encoder = encoder::get_backends("target/").remove(0).1().unwrap();
        let decoder = decoder::get_backends("target/").remove(0).1().unwrap();
        let mut whisper = Whisper::new(encoder, decoder, 5, 5, 1.0, 2, 5.0).await?;

        let mut i = 0;
        let file = &mut File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open("target/transcript.json")?;
        whisper
            .transcribe(&ar, None, &mut |bar| {
                println!("{i}: {}", bar.as_string());
                writeln!(file, "{}", bar.as_json()).unwrap();
                i += 1;
            })
            .await?;
    } else if let Some(_matches) = m.subcommand_matches("sysinfo") {
        println!("{}", get_system_string());
    }

    Ok(())
}

fn benchmark(n: usize, mut work: impl FnMut()) -> (f32, f32, f32) {
    benchmark_with_setup(n, || {
        let start: Instant = Instant::now();
        work();
        start.elapsed().as_secs_f32()
    })
}

fn benchmark_with_setup(n: usize, mut work: impl FnMut() -> f32) -> (f32, f32, f32) {
    let mut times: Vec<f32> = (0..n).map(|_| work()).collect();
    times.remove(0); // first run is warmup
    let min = *times.iter().min_by(|a, b| a.total_cmp(b)).unwrap();
    let mean = times.iter().sum::<f32>() / times.len() as f32;
    let max = *times.iter().max_by(|a, b| a.total_cmp(b)).unwrap();
    (min * 1000., mean * 1000., max * 1000.)
}

async fn report_benchmark_result(backend: &str, task: &str, duration: f32) -> Result<()> {
    let machine = get_system_string();
    let commit_date =
        compile_time_run::run_command_str!("git", "--no-pager", "log", "-1", "--format=\"%ai\"");
    let commit = compile_time_run::run_command_str!(
        "git",
        "describe",
        "--abbrev=10",
        "--dirty",
        "--long",
        "--tags"
    );
    let payload = format!(
        "{{
            \"machine\": \"{machine}\",
            \"backend\": \"{backend}\",
            \"task\": \"{task}\",
            \"commitDate\": {commit_date},
            \"commit\": \"{commit}\",
            \"duration\": {duration}
        }}"
    );

    let client = reqwest::Client::new();
    let res = client
        .post("https://fttw-perf.niemo.de/api/collections/benchmarks/records")
        .body(payload)
        .header("Content-Type", "application/json")
        .send()
        .await?;
    res.error_for_status()?;

    Ok(())
}

fn get_system_string() -> String {
    let sys = sysinfo::System::new_all().unwrap();
    let mut str = format!(
        "{} with {} ({} cores; {}GB)",
        sysinfo::System::long_os_version().unwrap(),
        sys.cpus()[0].brand(),
        sys.cpus().len(),
        sys.total_memory() / 1024 / 1024 / 1024
    );
    for gpu in &sysinfo::Gpus::new_with_refreshed_list().unwrap() {
        str += &format!(" + GPU: {}", gpu.model().unwrap());
        if let Some(mem) = gpu.total_memory() {
            str += &format!("({}GB)", mem / 1024 / 1024 / 1024)
        }
    }

    str
}
