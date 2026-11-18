use crate::audio_reader::AudioReader;
use crate::transcribee_api_client::{
    Task, TaskParameters, TaskProgress, TranscribeeWorkerApiClient,
};
use crate::whisper::decoder_loop::{Whisper, WhisperBar};
use crate::whisper::tokenizer::Tokenizer;
use crate::whisper::{decoder, encoder};
use anyhow::{Ok, Result};
use automerge::transaction::Transactable;
use automerge::{Automerge, ReadDoc};
use futures::{SinkExt, StreamExt};
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering::Relaxed;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::runtime::Handle;
use tokio::spawn;
use tokio::task::spawn_blocking;
use tokio::time::{sleep, timeout};
use tokio_tungstenite::tungstenite::{Bytes, Message};
use tracing::{Level, event};

pub async fn run_worker(base_url: &str, token: &str) -> Result<()> {
    let client = Arc::new(tokio::sync::Mutex::new(TranscribeeWorkerApiClient::new(
        base_url, token,
    )));

    loop {
        let task = match client.lock().await.claim_unassigned_task().await {
            Result::Ok(task) => task,
            Err(e) => {
                event!(Level::ERROR, "could not reach coordinator: {e:?}");
                sleep(Duration::from_secs(1)).await;
                continue;
            }
        };
        let Some(task) = task else {
            sleep(Duration::from_secs(1)).await;
            continue;
        };

        let should_continue = Arc::new(AtomicBool::new(true));
        let progress = Arc::new(Mutex::new(TaskProgress {
            step: "initial".to_string(),
            progress: None,
            extra_data: serde_json::Value::Null,
            timestamp: chrono::Local::now(),
        }));

        let keepalive = {
            let progress = progress.clone();
            let should_continue = should_continue.clone();
            let client = client.clone();
            spawn(async move {
                while should_continue.load(Relaxed) {
                    let progress = progress.lock().unwrap().clone();
                    let task_still_exists = client
                        .lock()
                        .await
                        .task_keepalive(&task.id, &progress)
                        .await;
                    if let Result::Ok(task_still_exists) = task_still_exists {
                        should_continue.fetch_and(task_still_exists, Relaxed);
                    }
                    sleep(Duration::from_secs(1)).await;
                }
                Ok(())
            })
        };

        let result = process_task(&task, should_continue, progress, client.clone()).await;
        let _ = keepalive.await;
        let mark_result = match result {
            Result::Ok(()) => client.lock().await.task_mark_completed(&task.id).await,
            Err(_) => client.lock().await.task_mark_failed(&task.id).await,
        };
        if let Err(e) = mark_result {
            event!(Level::ERROR, "marking task failed: {e:?}");
        }
    }
}

pub async fn process_task(
    task: &Task,
    should_continue: Arc<AtomicBool>,
    progress: Arc<Mutex<TaskProgress>>,
    client: Arc<tokio::sync::Mutex<TranscribeeWorkerApiClient>>,
) -> Result<()> {
    let encoder = encoder::get_backends("target/").remove(0).1().unwrap();
    let decoder = decoder::get_backends("target/").remove(0).1().unwrap();
    let tokenizer = Tokenizer::new().await?;
    let whisper = Arc::new(Mutex::new(Whisper::new(encoder, decoder, tokenizer, 5)?));

    let media_file = task.document.media_files.first().unwrap();
    let media_file = client.lock().await.get_media(media_file).await?;
    let ar = AudioReader::new(&media_file.path)?;

    let language = if let TaskParameters::Transcribe(params) = &task.task_parameters {
        if params.lang == "auto" {
            None
        } else {
            Some(params.lang.clone())
        }
    } else {
        unreachable!()
    };

    let ws = Arc::new(tokio::sync::Mutex::new(
        client.lock().await.get_websocket(&task.document).await?,
    ));
    let ws_ping_responder = {
        let should_continue = should_continue.clone();
        let ws = ws.clone();
        spawn(async move {
            while should_continue.load(Relaxed) {
                if let Result::Ok(Some(Result::Ok(Message::Ping(payload)))) =
                    timeout(Duration::from_millis(10), async {
                        ws.lock().await.next().await
                    })
                    .await
                {
                    ws.lock().await.send(Message::Pong(payload)).await.unwrap()
                }
                sleep(Duration::from_millis(100)).await;
            }
        })
    };

    let mut doc = Automerge::new();
    doc.transact(|doc| {
        doc.put(automerge::ROOT, "version", 1)?;
        doc.put_object(automerge::ROOT, "children", automerge::ObjType::List)?;
        doc.put_object(automerge::ROOT, "speaker_names", automerge::ObjType::List)?;
        Ok(())
    })
    .unwrap();
    ws.lock()
        .await
        .send(tokio_tungstenite::tungstenite::Message::Binary(
            Bytes::copy_from_slice(doc.get_last_local_change().unwrap().raw_bytes()),
        ))
        .await?;

    let mut on_new_bar = move |bar: WhisperBar| {
        doc.transact(|doc| {
            let paragraphs = doc.get(automerge::ROOT, "children")?.unwrap().1;
            let paragraphs_len = doc.length(&paragraphs);
            let paragraph =
                doc.insert_object(paragraphs, paragraphs_len, automerge::ObjType::Map)?;
            let ty = doc.put_object(&paragraph, "type", automerge::ObjType::Text)?;
            doc.splice_text(&ty, 0, 0, "paragraph")?;
            let lang = doc.put_object(&paragraph, "lang", automerge::ObjType::Text)?;
            doc.splice_text(&lang, 0, 0, &bar.language)?;
            doc.put(&paragraph, "speaker", automerge::ScalarValue::Null)?;
            let children = doc.put_object(&paragraph, "children", automerge::ObjType::List)?;
            for (i, atom) in bar.atoms.iter().enumerate() {
                let child = doc.insert_object(&children, i, automerge::ObjType::Map)?;
                let text = doc.put_object(&child, "text", automerge::ObjType::Text)?;
                doc.splice_text(&text, 0, 0, &atom.text)?;
                doc.put(&child, "start", atom.start as f64)?;
                doc.put(&child, "end", atom.end as f64)?;
                doc.put(&child, "conf", atom.conf as f64)?;
                doc.put(&child, "conf_ts", atom.conf_ts as f64)?;
            }
            Ok(())
        })
        .unwrap();

        let handle = Handle::current();
        let guard = handle.enter();
        futures::executor::block_on(async {
            ws.lock()
                .await
                .send(tokio_tungstenite::tungstenite::Message::Binary(
                    Bytes::copy_from_slice(doc.get_last_local_change().unwrap().raw_bytes()),
                ))
                .await
        })
        .unwrap();
        drop(guard);

        println!("{}", bar.as_string());
    };

    let progress = progress.clone();
    let mut on_progress = {
        let should_continue = should_continue.clone();
        move |p: f32| {
            *progress.lock().unwrap() = TaskProgress {
                step: "transcribe".to_string(),
                progress: Some(p),
                extra_data: serde_json::Value::Null,
                timestamp: chrono::Local::now(),
            };
            should_continue.load(Relaxed)
        }
    };

    let whisper = whisper.clone();
    spawn_blocking(move || {
        whisper
            .lock()
            .unwrap()
            .transcribe(&ar, language, &mut on_new_bar, &mut on_progress)
    })
    .await??;
    should_continue.store(false, Relaxed);
    ws_ping_responder.await?;
    Ok(())
}
