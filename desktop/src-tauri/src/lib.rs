use crate::cmd::install_cmds;
use crate::window::create_or_focus_main_window;
use colored::Color;
use log::Level;
use tauri::RunEvent;
use tauri_plugin_log::fern;
use tauri_plugin_window_state::StateFlags;

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
        .plugin(file_handling::init())
        .plugin(media_file_serve::init())
        .plugin(worker_plugin::init());

    let builder = builder.setup(|app| {
        tauri::async_runtime::block_on(async {
            create_or_focus_main_window(app.handle()).await.unwrap();
        });
        Ok(())
    });

    builder
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
                tauri::async_runtime::block_on(async {
                    // click on macOS dock opens main window again
                    create_or_focus_main_window(app).await.unwrap();
                });
            }
            _ => {}
        });
}
