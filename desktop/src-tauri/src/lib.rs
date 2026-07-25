use crate::file_handling::{
    append_automerge_change, append_automerge_change_to_transcribee_file, document_media,
    forget_document, get_document, get_documents, get_media_file_response, open_document,
    transcribe_file, DocumentsStoreExt,
};
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
use tauri::{Emitter, Manager};
use tauri_plugin_log::fern;
use tauri_plugin_store::StoreExt;
use worker_adapter::WorkerAdapter;

mod file_handling;
mod http_partial_content;
mod tar;
mod worker_plugin;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .format(|callback: fern::FormatCallback, message, record| {
                    let mut color = match record.metadata().target() {
                        "worker" => Color::Blue,
                        _ => Color::Black,
                    };
                    if record.metadata().level() == Level::Error {
                        color = Color::Red;
                    }

                    callback.finish(format_args!(
                        "{color_line}{target: <8}| {message}\x1B[0m",
                        color_line = format_args!("\x1B[{}m", color.to_fg_str()),
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
            open_document,
            transcribe_file,
            document_media,
            read_automerge,
            append_automerge_change,
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
            tokio::runtime::Runtime::new().unwrap().block_on(async {
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
