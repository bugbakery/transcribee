use std::collections::HashMap;

use clap::Parser;
use clap::arg;
use clap::command;
use clap::value_parser;
use desktop_backend::BackendBuilder;
use desktop_backend::state::BACKEND_STATE;
use desktop_backend::state::Document;
use desktop_backend::state::MediaFile;
use desktop_backend::state::Task;
use desktop_backend::state::TaskParameters;
use desktop_backend::state::TaskState;
use desktop_backend::state::TaskType;
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
