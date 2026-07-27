use crate::file_handling::{
    append_automerge_change, append_automerge_change_to_transcribee_file, forget_document,
    get_document, get_documents, get_media_file_response, DocumentsStoreExt,
};
use crate::window::create_or_focus_main_window;
use colored::Color;
use file_handling::read_automerge;
use http::{
    header::{ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_TYPE},
    response::Builder as ResponseBuilder,
    StatusCode,
};
use log::Level;
use serde_json::json;
use std::time::Duration;
use tauri::RunEvent;
use tauri::{Emitter, Manager};
use tauri_plugin_log::fern;
use tauri_plugin_store::StoreExt;
use tauri_plugin_window_state::StateFlags;
use worker_adapter::WorkerAdapter;

mod cmd;
mod cmd_error;
mod file_handling;
mod http_partial_content;
mod menu;
mod tar;
mod window;
mod worker_plugin;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(worker_plugin::init())
        .invoke_handler(tauri::generate_handler![
            get_documents,
            forget_document,
            get_document,
            read_automerge,
            append_automerge_change,
            cmd::transcribe_files,
            cmd::show_new_transcript_dialog,
            cmd::toggle_devtools,
            cmd::open_document_via_file_picker,
            cmd::open_document_window,
        ])
        .register_asynchronous_uri_scheme_protocol("media", move |ctx, request, responder| {
            match get_media_file_response(ctx.app_handle(), request) {
                Ok(http_response) => responder.respond(http_response),
                Err(e) => responder.respond(
                    ResponseBuilder::new()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .header(CONTENT_TYPE, "text/plain")
                        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .body(e.to_string().as_bytes().to_vec())
                        .unwrap(),
                ),
            }
        })
        .setup(|app| {
            app.store_builder("documents.json")
                .auto_save(Duration::from_secs(1))
                .build()?;

            let worker_adapter = app.state::<WorkerAdapter>();
            tauri::async_runtime::block_on(async {
                let app_handle = app.app_handle().clone();
                worker_adapter
                    .inner()
                    .automerge_listeners
                    .lock()
                    .await
                    .add_listener(move |task, change: Vec<u8>| {
                        let document = app_handle.get_document_from_task(task).unwrap();
                        append_automerge_change_to_transcribee_file(
                            &document.app_data_path,
                            &change,
                        )
                        .unwrap();
                        app_handle
                            .emit(
                                &format!("automerge_change:{}", document.id),
                                json!({
                                    "change": change,
                                }),
                            )
                            .unwrap();
                    });
                let app_handle = app.app_handle().clone();
                worker_adapter
                    .inner()
                    .progress_listeners
                    .lock()
                    .await
                    .add_listener(move |task, progress: Option<f32>| {
                        if let Some(progress) = progress {
                            let doc = app_handle.get_document_from_task(task).unwrap();
                            app_handle
                                .update_document(doc.id, |mut doc| {
                                    doc.transcription_progress = progress;
                                    doc
                                })
                                .unwrap();
                        }
                    })
            });

            create_or_focus_main_window(app.handle()).unwrap();

            #[cfg(target_os = "macos")]
            crate::menu::setup_macos_menu(app.handle())?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|#[allow(unused_variables)] app, event| match event {
            RunEvent::Exit => {
                log::info!("Exit");
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
                create_or_focus_main_window(app).unwrap();
            }
            _ => {}
        });
}
