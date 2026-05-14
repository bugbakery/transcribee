use tauri_plugin_shell::ShellExt;

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
        Ok(format!("Result: {}", String::from_utf8(output.stdout).unwrap()))
    } else {
        Err(format!("Exit with code: {}", output.status.code().unwrap()))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![ffmpeg_help])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
