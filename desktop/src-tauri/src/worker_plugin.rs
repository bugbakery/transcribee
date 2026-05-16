use log::{error, info, log, Level};
use tauri::Manager;
use tauri::{
    path::BaseDirectory,
    plugin::{Builder, TauriPlugin},
    Runtime,
};
use tauri_plugin_shell::ShellExt;

use crate::backend_plugin::BackendState;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("transcribee-worker")
        .setup(|app, _| {
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
                let backend_state = app.state::<BackendState>();

                loop {
                    info!(target: "worker", "starting worker");
                    let (mut events, _) = shell
                        .command(resource_path.clone())
                        .args(["--coordinator", &format!("http://{}:{}/", backend_state.local_addr.ip(), backend_state.local_addr.port()), "--token", &backend_state.token])
                        .spawn()
                        .unwrap();

                    let mut stderr = Vec::new();
                    let mut stdout = Vec::new();

                    fn output_buffer(buf: &mut Vec<u8>, level: Level, always_output: bool) {
                        while let Some(pos) = buf.iter().position(|b| *b == '\n' as u8) {
                            let line = String::from_utf8_lossy(&buf[..pos]);
                            log!(target: "worker", level, "{}", line);
                            buf.drain(..pos+1);
                        }
                        if always_output {
                            let line = String::from_utf8_lossy(&buf);
                            if !line.is_empty() {
                                log!(target: "worker", level, "{}", line);
                            }
                            buf.drain(..);
                        }
                    }

                    while let Some(event) = events.recv().await {
                        match event {
                            tauri_plugin_shell::process::CommandEvent::Stderr(v) => stderr.extend_from_slice(&v),
                            tauri_plugin_shell::process::CommandEvent::Stdout(v) => stdout.extend_from_slice(&v),
                            tauri_plugin_shell::process::CommandEvent::Error(e) => error!(target: "worker", "error: {e}"),
                            tauri_plugin_shell::process::CommandEvent::Terminated(
                                terminated_payload,
                            ) => {
                                for (buf, level) in [(&mut stderr, Level::Error), (&mut stdout, Level::Info)] {
                                    output_buffer(buf, level, true);
                                }
                                if let Some(code) = terminated_payload.code {
                                    error!(target: "worker", "worker terminated with exit code {code}")
                                } else if let Some(signal) = terminated_payload.signal {
                                    error!(target: "worker", "worker terminated by signal {signal}")
                                } else {
                                    error!(target: "worker", "worker terminated")
                                }
                            },
                            _ => {},
                        }

                        for (buf, level) in [(&mut stderr, Level::Error), (&mut stdout, Level::Info)] {
                            output_buffer(buf, level, false);
                        }
                    }
                }
            });
            Ok(())
        })
        .build()
}
