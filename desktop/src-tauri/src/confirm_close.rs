use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogResult};
use worker_adapter::{state::TaskState::Completed, WorkerAdapter};

pub async fn confirm_close_dialog(app: AppHandle) -> bool {
    let adapter = app.state::<WorkerAdapter>();
    if adapter
        .tasks
        .lock()
        .await
        .tasks
        .iter()
        .any(|(_uuid, task)| task.state != Completed)
    {
        let dialog_res = app
                    .dialog()
                    .message("There are still transcription jobs running, which will be canceled and their progress will be lost.")
                    .title("Quit Transcribee?")
                    .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
                    .buttons(tauri_plugin_dialog::MessageDialogButtons::YesNo)
                    .blocking_show_with_result();
        dialog_res == MessageDialogResult::Yes
    } else {
        true
    }
}
