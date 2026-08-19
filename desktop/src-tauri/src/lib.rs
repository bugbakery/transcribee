use std::ffi::OsStr;
use std::path::PathBuf;

use crate::file_handling::DocumentsStoreExt;
use crate::window::{create_or_focus_document_window, create_or_focus_main_window};
use crate::{before_exit::BeforeExitState, cmd::install_cmds};
use colored::Color;
use log::{error, warn, Level};
use tauri::async_runtime::block_on;
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_log::fern;
use tauri_plugin_window_state::StateFlags;

mod before_exit;
mod cmd;
mod cmd_error;
mod file_handling;
mod http_partial_content;
mod media_file_serve;
mod menu;
mod range_util;
mod tar;
mod transcribee_archive;
mod window;
mod worker_plugin;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED)
                .with_filter(|label| !label.starts_with("dialog/"))
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .format(|callback: fern::FormatCallback, message, record| {
                    let mut color = match record.metadata().target() {
                        "worker" => Some(Color::Blue),
                        _ => None,
                    };
                    if record.metadata().level() == Level::Error {
                        color = Some(Color::Red);
                    }

                    let color_code = if let Some(color) = color {
                        color.to_fg_str()
                    } else {
                        "0".into()
                    };

                    callback.finish(format_args!(
                        "{color_line}{target: <8}| {message}\x1B[0m",
                        color_line = format_args!("\x1B[{}m", color_code),
                        target = record.target(),
                        message = message,
                    ))
                })
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build());

    let builder = install_cmds(builder)
        .plugin(menu::init())
        .plugin(media_file_serve::init())
        .plugin(file_handling::init()) // this depends on media_file_serve (because it needs MediaFileBase)
        .plugin(before_exit::init())
        .plugin(worker_plugin::init());

    let builder = builder.setup(|app| {
        block_on(create_or_focus_main_window(app.handle())).unwrap();

        if cfg!(any(windows, target_os = "linux")) {
            let mut files = Vec::new();

            for maybe_file in std::env::args().skip(1) {
                // skip flag args
                if maybe_file.starts_with('-') {
                    continue;
                }

                if let Ok(url) = tauri::Url::parse(&maybe_file) {
                    // handle `file://` urls and ignore other schemes
                    if let Ok(path) = url.to_file_path() {
                        files.push(path);
                    } else {
                        warn!(
                            "Skipping file argument with unknown scheme {:?}",
                            url.scheme()
                        );
                    }
                } else {
                    // non-urls should be plain file paths
                    files.push(PathBuf::from(maybe_file))
                }
            }

            handle_file_associations(app.handle(), files);
        }

        Ok(())
    });

    builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|#[allow(unused_variables)] app, event| match event {
            RunEvent::Exit => {
                log::info!("Exit");
                let before_exit_state = app.state::<BeforeExitState>();
                block_on(before_exit_state.handle_exit());
            }
            RunEvent::ExitRequested { api, code, .. } => {
                log::info!("Exit requested with code {:?}", code);

                if code.is_none() {
                    // on macOS do not exit when last window is closed
                    if cfg!(target_os = "macos") {
                        api.prevent_exit();
                    }
                }
            }
            #[cfg(target_os = "macos")]
            RunEvent::Reopen {
                has_visible_windows,
                ..
            } if !has_visible_windows => {
                // click on macOS dock opens main window again
                block_on(create_or_focus_main_window(app)).unwrap();
            }
            #[cfg(target_os = "macos")]
            RunEvent::Opened { urls } => {
                let transcribee_files = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .collect();

                handle_file_associations(app.app_handle(), transcribee_files);
            }
            _ => {}
        });
}

fn handle_file_associations(app: &AppHandle, files: Vec<PathBuf>) {
    let transcribee_files = files
        .iter()
        .filter(|f| f.extension() == Some(OsStr::new("transcribee")));

    for file in transcribee_files {
        let file = file.to_string_lossy();
        let doc = match app.open_document(&file) {
            Ok(doc) => doc,
            Err(e) => {
                error!("Failed to open associated file {file:?}: {e:?}");
                app.dialog()
                    .message(format!("Could not open file: {file}"))
                    .show(|_ok| {});
                continue;
            }
        };

        if let Err(e) = block_on(create_or_focus_document_window(app, &doc, false)) {
            error!("Failed to create document window: {e:?}");
        }
    }
}
