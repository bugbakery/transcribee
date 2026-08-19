use crate::before_exit::BeforeExitState;
use crate::file_handling::{DocumentsStoreExt, MediaFile};
use crate::transcribee_archive;
use anyhow::Result;
use kill_tree::blocking::kill_tree;
use log::{error, info, log, warn, Level};
use rand::{distr::Alphanumeric, RngExt};
use serde_json::json;
use std::{net::SocketAddr, time::Duration};
use tauri::{is_dev, Emitter};
use tauri::{
    path::BaseDirectory,
    plugin::{Builder, TauriPlugin},
    Runtime,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;
use tokio::time::sleep;
use worker_adapter::state::TaskType::{self, IdentifySpeakers, Reencode, Transcribe};
use worker_adapter::WorkerAdapter;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("transcribee-worker")
        .setup(|app, _| {
            let (addr, token) = setup_worker_adapter(app)?;
            setup_worker(app, addr, token.clone(), vec![Reencode])?;
            setup_worker(app, addr, token, vec![Transcribe, IdentifySpeakers])?;
            install_worker_adapter_documents_store_sync(app)?;
            Ok(())
        })
        .build()
}

fn setup_worker<R: Runtime>(
    app: &AppHandle<R>,
    local_addr: SocketAddr,
    token: String,
    task_types: Vec<TaskType>,
) -> Result<()> {
    let ext = if cfg!(target_family = "windows") {
        "bat"
    } else {
        "sh"
    };
    let resource_path = app
        .path()
        .resolve(format!("worker/run_worker.{ext}"), BaseDirectory::Resource)?;

    let app = app.clone();

    let models_directory = app
        .path()
        .resolve("models", BaseDirectory::AppData)?
        .to_string_lossy()
        .to_string();

    tauri::async_runtime::spawn(async move {
        let shell = app.shell();

        loop {
            info!(target: "worker", "starting worker");

            // in dev mode we simply start the worker from ../../worker with uv while in production
            // we use the bundled worker
            let builder = if is_dev() {
                shell
                    .command("uv")
                    .args([
                        "run",
                        "transcribee-worker",
                        "--coordinator",
                        &format!("http://{}:{}", local_addr.ip(), local_addr.port()),
                        "--token",
                        &token,
                        "--task-types",
                        &task_types
                            .iter()
                            .map(TaskType::as_worker_arg)
                            .collect::<String>(),
                    ])
                    .current_dir("../../worker")
            } else {
                shell.command(resource_path.clone()).args([
                    "--coordinator",
                    &format!("http://{}:{}", local_addr.ip(), local_addr.port()),
                    "--token",
                    &token,
                ])
            };
            let (mut events, child) = builder
                .env("WORKER_TYPE", "desktop")
                .env("MODELS_DIR", models_directory.clone())
                .spawn()
                .unwrap();

            let before_exit_state = app.state::<BeforeExitState>();
            let exit_listener = before_exit_state
                .before_exit(Box::new(move || {
                    info!("Killing worker process before exiting...");
                    // Without explicit killing the worker keeps running on windows.
                    // Also normal child.kill() is not enough (at least when uv is used).
                    if let Err(e) = kill_tree(child.pid()) {
                        error!("Could not kill worker process: {e:?}");
                    }
                }))
                .await;

            let mut stderr = Vec::new();
            let mut stdout = Vec::new();

            fn output_buffer(buf: &mut Vec<u8>, level: Level, always_output: bool) {
                while let Some(pos) = buf.iter().position(|b| *b == b'\n') {
                    let line = String::from_utf8_lossy(&buf[..pos]);
                    log!(target: "worker", level, "{}", line);
                    buf.drain(..pos + 1);
                }
                if always_output {
                    let line = String::from_utf8_lossy(buf);
                    if !line.is_empty() {
                        log!(target: "worker", level, "{}", line);
                    }
                    buf.drain(..);
                }
            }

            while let Some(event) = events.recv().await {
                match event {
                    tauri_plugin_shell::process::CommandEvent::Stderr(v) => {
                        stderr.extend_from_slice(&v)
                    }
                    tauri_plugin_shell::process::CommandEvent::Stdout(v) => {
                        stdout.extend_from_slice(&v)
                    }
                    tauri_plugin_shell::process::CommandEvent::Error(e) => {
                        error!(target: "worker", "error: {e}")
                    }
                    tauri_plugin_shell::process::CommandEvent::Terminated(terminated_payload) => {
                        for buf in [&mut stderr, &mut stdout] {
                            output_buffer(buf, Level::Info, true);
                        }
                        if let Some(code) = terminated_payload.code {
                            error!(target: "worker", "worker terminated with exit code {code}")
                        } else if let Some(signal) = terminated_payload.signal {
                            error!(target: "worker", "worker terminated by signal {signal}")
                        } else {
                            error!(target: "worker", "worker terminated")
                        }
                    }
                    _ => {}
                }

                for buf in [&mut stderr, &mut stdout] {
                    output_buffer(buf, Level::Info, false);
                }
            }

            before_exit_state
                .unregister_before_exit(exit_listener)
                .await;

            sleep(Duration::from_secs(5)).await;
        }
    });

    Ok(())
}

fn random_token() -> String {
    let mut rng = rand::rng();
    (0..32).map(|_| rng.sample(Alphanumeric) as char).collect()
}

fn setup_worker_adapter<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(SocketAddr, String), Box<dyn std::error::Error>> {
    let token: String = random_token();

    let adapter = WorkerAdapter::new(token.clone());
    let app_handle = app.clone();
    tauri::async_runtime::block_on(adapter.install_document_getter(move |uuid| {
        match app_handle
            .get_document(uuid)
            .and_then(|document| transcribee_archive::get_automerge_doc(&document.app_data_path))
        {
            Ok(document) => document,
            Err(e) => {
                error!("could not get automerge doc for document {uuid}: {e:?}");
                vec![]
            }
        }
    }));
    app.manage(adapter.clone());

    let listener = WorkerAdapter::bind(None)?;
    let local_addr = listener.local_addr()?;
    log::info!("starting backend on http://{:?}", local_addr);
    tauri::async_runtime::spawn(async move { adapter.serve(listener).await });

    Ok((local_addr, token))
}

pub fn install_worker_adapter_documents_store_sync<R: Runtime>(
    app: &AppHandle<R>,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let worker_adapter = app.state::<WorkerAdapter>();
    tauri::async_runtime::block_on(async {
        let app_handle = app.app_handle().clone();
        worker_adapter
            .inner()
            .automerge_listeners
            .lock()
            .await
            .add_listener(move |document_uuid, change: Vec<u8>| {
                let Ok(document) = app_handle.get_document(document_uuid) else {
                    warn!("document for which we received a change does not exist anymore");
                    return;
                };
                transcribee_archive::append_automerge_change(&document.app_data_path, &change)
                    .unwrap();
                app_handle
                    .emit(
                        &format!("automerge_change:{}", document.id),
                        json!({
                            "change": change,
                        }),
                    )
                    .unwrap();
                app_handle
                    .update_document(document.id, |mut doc| {
                        doc.has_unsaved_changes = true;
                        doc
                    })
                    .unwrap();
            });
        let app_handle = app.app_handle().clone();
        worker_adapter
            .inner()
            .progress_listeners
            .lock()
            .await
            .add_listener(move |document_uuid, _| {
                let Ok(doc) = app_handle.get_document(document_uuid) else {
                    warn!("got progress for document {document_uuid} which does not exist");
                    return;
                };
                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let worker_adapter = app_handle.state::<WorkerAdapter>();
                    let tasks: Vec<_> = worker_adapter
                        .tasks
                        .lock()
                        .await
                        .tasks
                        .iter()
                        .filter_map(|(_, task)| {
                            if task.document.id == document_uuid {
                                Some(task.clone())
                            } else {
                                None
                            }
                        })
                        .collect();
                    app_handle
                        .update_document(doc.id, move |mut doc| {
                            doc.worker_tasks = tasks.clone();
                            doc
                        })
                        .unwrap();
                });
            });

        let app_handle = app.app_handle().clone();
        worker_adapter
            .inner()
            .media_file_listeners
            .lock()
            .await
            .add_listener(
                move |document, media_file: worker_adapter::state::MediaFile| {
                    app_handle
                        .update_document(document, |mut doc| {
                            let mut media_file = MediaFile::from_worker_adapter_media_file(
                                media_file.clone(),
                                document,
                            )
                            .unwrap();
                            media_file.tags.push("browser_compatible".to_string());
                            doc.media_files.push(media_file);
                            doc
                        })
                        .unwrap();
                },
            );
    });
    Ok(())
}
