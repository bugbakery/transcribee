use automerge::{Automerge, ObjId, ReadDoc};
use kill_tree::blocking::kill_tree;
use nonblock::NonBlockingReader;
use std::{
    fs,
    io::Write,
    path::Path,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{
    spawn,
    sync::oneshot,
    task::JoinHandle,
    time::{sleep, timeout},
};
use uuid::Uuid;
use worker_adapter::{
    WorkerAdapter,
    state::{TaskState::Completed, TranscribeTaskParameters},
};

async fn run_worker_and_adapter() -> (Child, WorkerAdapter, JoinHandle<()>) {
    let token = "SECRET_TOKEN";
    let adapter = WorkerAdapter::new(token.to_string());
    let listener = WorkerAdapter::bind(None).unwrap();
    let local_addr = listener.local_addr().unwrap();

    let worker = Command::new("uv")
        .args([
            "run",
            "transcribee-worker",
            "--coordinator",
            &format!("http://{}:{}", local_addr.ip(), local_addr.port()),
            "--token",
            token,
        ])
        .env("WORKER_TYPE", "desktop")
        .current_dir("../../worker")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();

    let adapter_for_serve = adapter.clone();
    let join_handle = spawn(async move {
        adapter_for_serve.serve(listener).await.unwrap();
    });

    (worker, adapter, join_handle)
}

fn transcribee_automerge_doc_to_text(automerge_bytes: &[u8]) -> String {
    let doc = Automerge::load(automerge_bytes).unwrap();
    let (_, children_idx) = doc.get(ObjId::Root, "children").unwrap().unwrap();
    let mut text = String::new();
    for child in doc.list_range(children_idx, ..) {
        let (_, words_idx) = doc.get(child.id(), "children").unwrap().unwrap();
        for word in doc.list_range(words_idx, ..) {
            let (_, text_idx) = doc.get(word.id(), "text").unwrap().unwrap();
            text += &doc.text(text_idx).unwrap();
        }
    }
    text
}

#[tokio::main]
async fn main() {
    let (worker, adapter, adapter_join_handle) = run_worker_and_adapter().await;
    let audio_path = Path::new("../../worker-ng/MLKDream_64kb.mp3")
        .canonicalize()
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    let document_uuid = Uuid::now_v7();
    let task = adapter
        .start_transcription(
            document_uuid,
            audio_path,
            TranscribeTaskParameters {
                lang: "auto".to_string(),
                model: "tiny".to_string(),
            },
        )
        .await;

    let (tx, rx) = oneshot::channel();
    let tx_holder = Arc::new(tokio::sync::Mutex::new(Some(tx)));
    let adapter_for_listener = adapter.clone();
    adapter
        .progress_listeners
        .lock()
        .await
        .add_listener(move |_uuid, _| {
            let adapter_for_listener = adapter_for_listener.clone();
            let tx_holder = tx_holder.clone();
            spawn(async move {
                if adapter_for_listener
                    .tasks
                    .lock()
                    .await
                    .get(&task.id)
                    .unwrap()
                    .state
                    == Completed
                {
                    tx_holder.lock().await.take().unwrap().send(()).unwrap();
                }
            });
        });

    let automerge_doc = Arc::new(Mutex::new(Vec::new()));
    let automerge_doc_for_listener = automerge_doc.clone();
    adapter
        .automerge_listeners
        .lock()
        .await
        .add_listener(move |_uuid, mut change| {
            automerge_doc_for_listener
                .lock()
                .unwrap()
                .append(&mut change)
        });

    let timeout_duration = Duration::from_mins(10);
    if let Err(_) = timeout(timeout_duration, rx).await {
        panic!("transcription timed out after {timeout_duration:?}");
    }

    kill_tree(worker.id()).unwrap();
    adapter_join_handle.abort();

    let text = transcribee_automerge_doc_to_text(&automerge_doc.lock().unwrap());
    assert_eq!(
        text,
        "This is an audio test file, it will be used to test the transcription abilities of TransCrivi, the open source transcription software."
    )
}
