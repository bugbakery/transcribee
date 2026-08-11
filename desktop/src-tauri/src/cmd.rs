use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, Window};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;
use uuid::Uuid;
use worker_adapter::{state::TranscribeTaskParameters, WorkerAdapter};

use crate::{
    cmd_error::CmdResult,
    file_handling::DocumentsStoreExt,
    menu::{update_macos_menu_items, MenuState},
    window::{
        create_or_focus_document_window, create_or_focus_main_window, create_or_focus_window,
        focused_window,
    },
};

#[tauri::command]
pub async fn transcribe_files(
    app: AppHandle,
    worker_adapter: State<'_, WorkerAdapter>,
    media_file_paths: Vec<String>,
    language: String,
    model: String,
) -> CmdResult<()> {
    for f in media_file_paths {
        let task_uuid = worker_adapter
            .start_transcription(
                f.clone(),
                TranscribeTaskParameters {
                    lang: language.clone(),
                    model: model.clone(),
                },
            )
            .await;

        app.create_new_document(f, vec![task_uuid])?;
    }

    create_or_focus_main_window(&app).await?;
    Ok(())
}

#[tauri::command]
pub fn toggle_devtools(app: AppHandle) {
    let windows = app.webview_windows();

    let focused_window = windows
        .iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false));

    if let Some((_, focused_window)) = focused_window {
        if focused_window.is_devtools_open() {
            focused_window.close_devtools();
        } else {
            focused_window.open_devtools();
        }
    }
}

#[tauri::command]
pub async fn open_document_window(app: AppHandle, id: Uuid) -> CmdResult<()> {
    let focused_window = focused_window(&app);
    let fullscreen = focused_window
        .clone()
        .and_then(|w| w.is_fullscreen().ok())
        .unwrap_or(false);
    let document = app.get_document(id)?;

    if let Some(focused_window) = focused_window {
        if focused_window.label() == "main" {
            focused_window.close().unwrap();
        }
    }

    create_or_focus_document_window(&app, &document, fullscreen).await?;
    Ok(())
}

#[tauri::command]
pub async fn open_document_via_file_picker(app: AppHandle) -> CmdResult<()> {
    let parent: tauri::WebviewWindow = match focused_window(&app) {
        Some(window) if window.label().starts_with("document/") => window,
        _ => create_or_focus_main_window(&app).await.unwrap(),
    };

    let (tx, rx) = oneshot::channel();

    let parent_clone = parent.clone();
    tauri::async_runtime::spawn(async move {
        parent_clone
            .dialog()
            .file()
            .add_filter("Transcribee Archive", &["transcribee"])
            .pick_file(|f| {
                tx.send(f).unwrap();
            });
    });

    let file = rx.await?;
    if let Some(file) = file {
        let fullscreen = parent.is_fullscreen().unwrap_or(false);
        let document = app.open_document(&file.to_string())?;

        if parent.label() == "main" {
            parent.close().unwrap();
        }

        create_or_focus_document_window(&app, &document, fullscreen).await?;
    }

    Ok(())
}

#[tauri::command]
pub async fn show_new_transcript_dialog(app: AppHandle) {
    let main_window = create_or_focus_main_window(&app).await.unwrap();
    let main_scale_factor = main_window.scale_factor().unwrap();
    let main_pos: LogicalPosition<f64> = main_window
        .outer_position()
        .unwrap()
        .to_logical(main_scale_factor);
    let main_size: LogicalSize<f64> = main_window
        .outer_size()
        .unwrap()
        .to_logical(main_scale_factor);

    let width = 380.0;
    let height = 450.0;

    create_or_focus_window(
        &app,
        "dialog/new_transcript",
        WebviewUrl::App("/new_transcript".into()),
        |builder| {
            builder
                .inner_size(width, height)
                .position(
                    main_pos.x + (main_size.width - width) / 2.0,
                    main_pos.y + 40.0,
                )
                .resizable(false)
        },
    )
    .await
    .unwrap();
}

#[tauri::command]
pub async fn show_main_window(app: AppHandle) {
    create_or_focus_main_window(&app).await.unwrap();
}

#[tauri::command]
pub fn set_available_menu_items(
    app: AppHandle,
    window: Window,
    menu_state: State<MenuState>,
    items: Vec<String>,
) {
    let mut menu_items = menu_state.menu_items.lock().unwrap();
    menu_items.insert(window.label().to_string(), items);
    drop(menu_items); // update_macos_menu_items also needs to acquire menu_items

    update_macos_menu_items(&app);
}
