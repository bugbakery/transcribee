use log::{error, info, log, Level};
use rand::{distr::Alphanumeric, RngExt};
use std::{net::SocketAddr, time::Duration};
#[cfg(debug_assertions)]
use tauri::is_dev;
use tauri::{
    path::BaseDirectory,
    plugin::{Builder, TauriPlugin},
    Runtime,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;
use tokio::time::sleep;
use worker_adapter::WorkerAdapter;

fn setup_worker<R: Runtime>(
    app: &AppHandle<R>,
    local_addr: SocketAddr,
    token: String,
) -> Result<(), Box<dyn std::error::Error>> {
    let ext = if cfg!(target_family = "windows") {
        "bat"
    } else {
        "sh"
    };
    let resource_path = app
        .path()
        .resolve(format!("worker/run_worker.{ext}"), BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    println!("{:?}", resource_path);

    let app = app.clone();

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
            let (mut events, _) = builder.env("WORKER_TYPE", "desktop").spawn().unwrap();

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
                        for (buf, level) in
                            [(&mut stderr, Level::Error), (&mut stdout, Level::Info)]
                        {
                            output_buffer(buf, level, true);
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

                for (buf, level) in [(&mut stderr, Level::Error), (&mut stdout, Level::Info)] {
                    output_buffer(buf, level, false);
                }
            }

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
    app.manage(adapter.clone());

    let listener = WorkerAdapter::bind(None)?;
    let local_addr = listener.local_addr()?;
    log::info!("starting backend on http://{:?}", local_addr);
    tauri::async_runtime::spawn(async move { adapter.serve(listener).await });

    Ok((local_addr, token))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("transcribee-worker")
        .setup(|app, _| {
            let (addr, token) = setup_worker_adapter(app)?;
            setup_worker(app, addr, token)?;
            Ok(())
        })
        .build()
}
