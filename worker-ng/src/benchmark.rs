use std::time::Instant;

use crate::whisper::{decoder, encoder};
use anyhow::Result;
use ndarray::Array2;

pub async fn benchmark_whisper() -> Result<()> {
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
        println!("-> register_encoded_audio_chunks \t min={min:.1} mean={mean:.1} max={max:.1}");
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
                report_benchmark_result(name, &format!("prefill {len} tokens batch {batch}"), mean)
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
        report_benchmark_result(name, "encode", mean).await?;
    }

    Ok(())
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

pub fn get_system_string() -> String {
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
