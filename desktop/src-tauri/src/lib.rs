use colored::Color;
use file_handling::read_automerge;
use http::{
    header::{ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_TYPE},
    response::Builder as ResponseBuilder,
    StatusCode,
};
use log::Level;
use tauri_plugin_log::fern;

use crate::file_handling::{append_automerge_change, get_file_from_archive_as_response};

mod backend_plugin;
mod file_handling;
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
        .plugin(backend_plugin::init())
        .plugin(worker_plugin::init())
        .invoke_handler(tauri::generate_handler![
            read_automerge,
            append_automerge_change
        ])
        .register_asynchronous_uri_scheme_protocol("archive", move |_ctx, request, responder| {
            match get_file_from_archive_as_response(request) {
                Ok(http_response) => responder.respond(http_response),
                Err(e) => responder.respond(
                    ResponseBuilder::new()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .header(CONTENT_TYPE, "text/plain")
                        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .body(dbg!(e.to_string()).as_bytes().to_vec())
                        .unwrap(),
                ),
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
