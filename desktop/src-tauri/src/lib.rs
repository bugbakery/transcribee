use colored::Color;
use log::Level;
use tauri_plugin_log::fern;
use tauri_plugin_shell::ShellExt;

mod backend;
mod backend_plugin;
mod worker_plugin;

#[tauri::command]
fn ffmpeg_help(app_handle: tauri::AppHandle) -> Result<String, String> {
    let shell = app_handle.shell();
    let output = tauri::async_runtime::block_on(async move {
        shell
            .command("ffmpeg")
            .args(["--help"])
            .output()
            .await
            .unwrap()
    });

    if output.status.success() {
        Ok(format!(
            "Result: {}",
            String::from_utf8(output.stdout).unwrap()
        ))
    } else {
        Err(format!("Exit with code: {}", output.status.code().unwrap()))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .plugin(worker_plugin::init())
        .plugin(backend_plugin::init())
        .invoke_handler(tauri::generate_handler![ffmpeg_help])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
