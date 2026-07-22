use clap::Parser;
use worker_adapter::WorkerAdapter;
use worker_adapter::state::TranscribeTaskParameters;

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
    #[arg(short, long)]
    port: Option<u16>,

    #[arg(short, long)]
    token: Option<String>,

    #[arg(short, long)]
    media_file: String,
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    env_logger::init();
    let args = Args::parse();

    let token = args.token.unwrap_or("SECRET_TOKEN".to_string()); // TODO: generate random

    let adapter = WorkerAdapter::new(token);

    let listener = WorkerAdapter::bind(args.port).unwrap();
    log::info!("starting backend on http://{:?}", listener.local_addr()?);

    tokio::runtime::Handle::current().block_on(adapter.start_transcription(
        args.media_file,
        TranscribeTaskParameters {
            lang: "auto".to_string(),
            model: "tiny".to_string(),
        },
    ));

    adapter.serve(listener).await
}
