use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogResult};

use crate::{
    cmd::{open_document_via_file_picker, toggle_devtools},
    window::create_or_focus_main_window,
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

    app.on_menu_event(|app, event| match event.id().0.as_str() {
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
            let app2 = app.clone();
            tauri::async_runtime::spawn(async move {
                open_document_via_file_picker(app2.clone()).await.unwrap()
            });
        }
        "new" => {
            create_or_focus_main_window(app).unwrap();
        }
        "developer_tools" => {
            toggle_devtools(app.clone());
        }
        unknown_event => {
            log::warn!("Unknown menu event received: {unknown_event}")
        }
    });

    Ok(())
}
