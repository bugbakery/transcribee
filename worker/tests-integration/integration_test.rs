#[cfg(test)]
mod test {
    use automerge::{Automerge, ObjId, ReadDoc};
    use kill_tree::blocking::kill_tree;
    use std::{
        path::Path,
        process::{Command, Stdio},
        sync::{Arc, Mutex},
        time::Duration,
    };
    use tokio::{spawn, sync::oneshot, time::timeout};
    use worker_adapter::{WorkerAdapter, state::TranscribeTaskParameters};

    #[tokio::test]
    async fn test_transcribe_sample() {
        let token = "SECRET_TOKEN";
        let adapter = WorkerAdapter::new(token.to_string());
        let listener = WorkerAdapter::bind(None).unwrap();
        let local_addr = listener.local_addr().unwrap();
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
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();

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

        spawn(async move {
            adapter.serve(listener).await.unwrap();
        });

        let timeout_duration = Duration::from_secs(30);
        if let Err(_) = timeout(timeout_duration, rx).await {
            panic!("transcription timed out after {timeout_duration:?}");
        }
        kill_tree(worker.id()).unwrap();

        let automerge_bytes = automerge_doc.lock().unwrap();
        let doc = Automerge::load(&automerge_bytes).unwrap();
        let (_, children_idx) = doc.get(ObjId::Root, "children").unwrap().unwrap();
        let mut text = String::new();
        for child in doc.list_range(children_idx, ..) {
            let (_, words_idx) = doc.get(child.id(), "children").unwrap().unwrap();
            for word in doc.list_range(words_idx, ..) {
                let (_, text_idx) = doc.get(word.id(), "text").unwrap().unwrap();
                text += &doc.text(text_idx).unwrap();
            }
        }
        assert_eq!(
            text,
            "This is an audio test file, it will be used to test the transcription abilities of TransCrivi, the open source transcription software."
        )
    }
}
