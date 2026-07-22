use std::collections::HashMap;

use clap::Parser;
use clap::arg;
use clap::command;
use clap::value_parser;
use worker_adapter::BackendBuilder;
use worker_adapter::state::BACKEND_STATE;
use worker_adapter::state::Document;
use worker_adapter::state::MediaFile;
use worker_adapter::state::Task;
use worker_adapter::state::TaskParameters;
use worker_adapter::state::TaskState;
use worker_adapter::state::TaskType;
use uuid::Uuid;

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
    #[arg(short, long)]
    port: Option<u16>,

    #[arg(short, long)]
    token: Option<String>,

    #[arg(short, long)]
    media_file: Option<String>,
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    env_logger::init();

    let args = Args::parse();

    let token = args.token.unwrap_or("SECRET_TOKEN".to_string()); // TODO: generate random
    let media_files = if let Some(path) = args.media_file {
        vec![MediaFile::new(path)]
    } else {
        Vec::new()
    };

    let document = Document::new("Test".to_string(), media_files);

    let id = document.id;
    BACKEND_STATE.lock().unwrap().add_document(document);
    BACKEND_STATE.lock().unwrap().add_task(Task {
        id: Uuid::new_v4(),
        task_type: TaskType::Reencode,
        state: TaskState::New,
        dependencies: Vec::new(),
        current_attempt: None,
        document: id,
        task_parameters: TaskParameters::NoParameters(HashMap::new()),
    });

    let mut backend = BackendBuilder::new().with_token(token.clone());
    if let Some(port) = args.port {
        backend = backend.with_port(port);
    }

    let local_addr = backend.bind().unwrap();
    log::info!("starting backend on http://{:?}", local_addr);
    backend.serve().await
}
