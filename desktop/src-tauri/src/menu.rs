/// We maintain two menus. A global menu for macOS (since this is how macOS applications work) and
/// a custom JS menu bar for other platforms. The JS menu bar is also used for indicating which
/// window specific menu items should be enabled in the macOS menu and provides the corresponding
/// handlers.
use std::{collections::HashMap, sync::Mutex};

use anyhow::bail;
use log::{error, warn};
use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, Submenu, SubmenuBuilder},
    AppHandle, Emitter, Listener, Manager, Wry,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogResult};

use crate::{
    cmd::{open_document_via_file_picker, toggle_devtools},
    cmd_error::CmdResult,
    window::{create_or_focus_main_window, focused_window},
};

/// Non-global menu items which will be enabled when a window specifies that they should be enabled.
/// Handlers are implemented in JS code.
static WINDOW_SPECIFIC_MENU_ITEMS: &[&str] = &["save", "save_as", "undo", "redo"];

#[derive(Debug, Default)]
pub struct MenuState {
    pub menu_items: Mutex<HashMap<String, Vec<String>>>,
}

#[allow(dead_code)]
pub fn setup_macos_menu(app: &AppHandle) -> tauri::Result<()> {
    app.manage(MenuState::default());

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
            "developer_tools" => {
                toggle_devtools(app);
            }
            event => {
                // some events are handled by the frontend
                app.emit("macos_menu_clicked", event)?;

                if !WINDOW_SPECIFIC_MENU_ITEMS.contains(&event) {
                    warn!("Menu event '{event}' has no handler. Maybe it is missing in WINDOW_SPECIFIC_MENU_ITEMS?");
                }
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

    let app_clone = app.clone();
    app.listen_any("tauri://focus", move |_| {
        update_macos_menu_items(&app_clone);
    });

    let app_clone = app.clone();
    app.listen_any("tauri://blur", move |_| {
        update_macos_menu_items(&app_clone);
    });

    Ok(())
}

pub fn update_macos_menu_items(app: &AppHandle) {
    if cfg!(target_os = "macos") {
        return;
    }

    let menu = &app
        .menu()
        .expect("app menu needs to be set before it can be updated");

    if let Some(window) = focused_window(app) {
        let state = app.state::<MenuState>();
        let menu_items = state.menu_items.lock().unwrap();

        let empty_vec = Vec::new();
        let items = menu_items.get(window.label()).unwrap_or(&empty_vec);

        WINDOW_SPECIFIC_MENU_ITEMS.iter().for_each(|i| {
            if let Err(e) = get_menu_item(menu, i).and_then(|item| {
                item.set_enabled(items.contains(&i.to_string()))
                    .map_err(|e| e.into())
            }) {
                error!("failed to update menu item '{i}': {e:?}");
            }
        })
    } else {
        WINDOW_SPECIFIC_MENU_ITEMS.iter().for_each(|i| {
            if let Err(e) = get_menu_item(menu, i)
                .and_then(|item| item.set_enabled(false).map_err(|e| e.into()))
            {
                error!("failed to disable menu item '{i}': {e:?}");
            }
        })
    }
}

/// Recursively retreives a menu item with the given id from a menu and it's submenus
fn get_menu_item(menu: &Menu<Wry>, id: &str) -> anyhow::Result<tauri::menu::MenuItem<Wry>> {
    if let Some(item) = menu.get(id) {
        return Ok(item.as_menuitem().unwrap().clone());
    }

    for item in menu.items()? {
        if let Some(submenu) = item.as_submenu() {
            if let Ok(item) = get_submenu_item(submenu, id) {
                return Ok(item);
            }
        }
    }

    bail!("item with id '{id}' not found")
}

/// Recursively retreives a menu item with the given id from a submenu and it's submenus
fn get_submenu_item(menu: &Submenu<Wry>, id: &str) -> anyhow::Result<tauri::menu::MenuItem<Wry>> {
    if let Some(item) = menu.get(id) {
        return Ok(item.as_menuitem().unwrap().clone());
    }

    for item in menu.items()? {
        if let Some(submenu) = item.as_submenu() {
            if let Ok(item) = get_submenu_item(submenu, id) {
                return Ok(item);
            }
        }
    }

    bail!("item with id '{id}' not found")
}
