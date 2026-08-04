use log::error;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogResult};

use crate::{
    cmd::{open_document_via_file_picker, toggle_devtools},
    cmd_error::CmdResult,
    file_handling::{save_document, save_document_as_dialog},
    window::{create_or_focus_main_window, get_focused_document_id},
};

#[allow(dead_code)]
pub fn setup_macos_menu(app: &AppHandle) -> tauri::Result<()> {
    // the first submenu automatically becomes the bold menu with the application name
    let transcribee_menu = SubmenuBuilder::new(app, "")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(
            &MenuItemBuilder::with_id("quit", "Quit Transcribee")
                .accelerator("Cmd+Q")
                .build(app)?,
        )
        .build()
        .unwrap();

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("new", "New Window")
                .accelerator("Cmd+N")
                .build(app)
                .unwrap(),
        )
        .item(
            &MenuItemBuilder::with_id("open", "Open Transcript…")
                .accelerator("Cmd+O")
                .build(app)
                .unwrap(),
        )
        .item(
            &MenuItemBuilder::with_id("save", "Save")
                .accelerator("Cmd+S")
                .build(app)
                .unwrap(),
        )
        .item(
            &MenuItemBuilder::with_id("save_as", "Save As...")
                .accelerator("Cmd+Shift+S")
                .build(app)
                .unwrap(),
        )
        .close_window()
        .build()
        .unwrap();

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .fullscreen()
        .build()
        .unwrap();

    let help_menu = SubmenuBuilder::new(app, "Help")
        .text("developer_tools", "Toggle Developer Tools")
        .build()
        .unwrap();

    let menu = MenuBuilder::new(app)
        .item(&transcribee_menu)
        .item(&file_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()
        .unwrap();

    menu.set_as_app_menu().unwrap();

    #[cfg(target_os = "macos")]
    {
        window_menu.set_as_windows_menu_for_nsapp().unwrap();
        help_menu.set_as_help_menu_for_nsapp().unwrap();
    }

    async fn menu_event_handler(app: AppHandle, event_id: &str) -> CmdResult<()> {
        match event_id {
            "quit" => {
                // TODO: only show when transcription jobs are running
                let dialog_res = app
                    .dialog()
                    .message("There are still transcription jobs running, which will be canceled.")
                    .title("Quit Transcribee?")
                    .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
                    .buttons(tauri_plugin_dialog::MessageDialogButtons::YesNo)
                    .blocking_show_with_result();
                if dialog_res == MessageDialogResult::Yes {
                    app.exit(0);
                }
            }
            "open" => {
                open_document_via_file_picker(app).await?;
            }
            "new" => {
                create_or_focus_main_window(&app).await?;
            }
            "save" => save_document(app.clone(), get_focused_document_id(&app)?).await?,
            "save_as" => {
                save_document_as_dialog(app.clone(), get_focused_document_id(&app)?).await?
            }
            "developer_tools" => {
                toggle_devtools(app);
            }
            unknown_event => {
                log::warn!("Unknown menu event received: {unknown_event}")
            }
        }
        Ok(())
    }

    app.on_menu_event(|app, event| {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let event_id = event.id.0.as_str();
            if let Err(e) = menu_event_handler(app, event_id).await {
                error!("error handling menu action {event_id}: {e:?}");
            }
        });
    });

    Ok(())
}
