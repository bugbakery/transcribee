#[cfg(test)]
mod test {
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
    use worker_adapter::{WorkerAdapter, state::TranscribeTaskParameters};

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
            .current_dir("../")
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

    #[tokio::test]
    async fn test_transcribe_sample() {
        let (worker, adapter, adapter_join_handle) = run_worker_and_adapter().await;
        let audio_path = Path::new("../tests/data/sample.mp3")
            .canonicalize()
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        adapter
            .start_transcription(
                audio_path,
                TranscribeTaskParameters {
                    lang: "auto".to_string(),
                    model: "tiny".to_string(),
                },
            )
            .await;

        let (tx, rx) = oneshot::channel();
        let mut tx_holder = Some(tx);
        adapter
            .progress_listeners
            .lock()
            .await
            .add_listener(move |_uuid, progress| {
                if let Some(1.0) = progress {
                    tx_holder.take().unwrap().send(()).unwrap();
                }
            });

        let automerge_doc = Arc::new(Mutex::new(Vec::new()));
        let automerge_doc_for_listener = automerge_doc.clone();
        adapter
            .automerge_listeners
            .lock()
            .await
            .add_listener(move |_uuid, mut change| {
                // yes this is O(n²) :)
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

    #[tokio::test]
    async fn test_transcribe_abort() {
        let path = "target/mlk.mp3";
        if !fs::exists(path).unwrap() {
            let bytes = reqwest::get("https://archive.org/download/MLKDream/MLKDream_64kb.mp3")
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap();
            fs::File::create_new(path)
                .unwrap()
                .write_all(&bytes)
                .unwrap();
        }

        let (mut worker, adapter, adapter_join_handle) = run_worker_and_adapter().await;
        let audio_path = Path::new(path)
            .canonicalize()
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let task = adapter
            .start_transcription(
                audio_path,
                TranscribeTaskParameters {
                    lang: "auto".to_string(),
                    model: "tiny".to_string(),
                },
            )
            .await;

        let (tx, rx) = oneshot::channel();
        let mut tx_holder = Some(tx);
        adapter
            .progress_listeners
            .lock()
            .await
            .add_listener(move |_uuid, progress| {
                if let Some(x) = progress
                    && x > 0.0
                {
                    if let Some(tx) = tx_holder.take() {
                        tx.send(()).unwrap();
                    }
                }
            });
        let timeout_duration = Duration::from_mins(10);
        if let Err(_) = timeout(timeout_duration, rx).await {
            panic!("transcription start timed out after {timeout_duration:?}");
        }

        adapter.tasks.lock().await.remove_task(task).unwrap();

        let stderr = worker.stderr.take().unwrap();
        let mut noblock_stderr = NonBlockingReader::from_fd(stderr).unwrap();
        let mut output = String::new();
        let start_time = Instant::now();
        let needle = "canceling task";
        let found = loop {
            let count = noblock_stderr
                .read_available_to_string(&mut output)
                .unwrap();
            print!("{}", &output[output.len() - count..]);
            if start_time.elapsed() > timeout_duration {
                break false;
            } else if output.contains(needle) {
                break true;
            }
            sleep(Duration::from_millis(100)).await;
        };
        if !found {
            panic!("timeout (after {timeout_duration:?} looking for 'canceling task' in output")
        }

        kill_tree(worker.id()).unwrap();
        adapter_join_handle.abort();
    }
}
