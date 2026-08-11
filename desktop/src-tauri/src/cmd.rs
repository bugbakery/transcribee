use crate::{
    cmd_error::CmdResult,
    file_handling::{Document, DocumentsStoreExt, FrontendDocument},
    menu::{update_macos_menu_items, MenuState},
    transcribee_archive::{self, MediaFileSource},
    window::{
        create_or_focus_document_window, create_or_focus_main_window, create_or_focus_window,
        focused_window,
    },
};
use anyhow::{anyhow, Result};
use log::warn;
use std::fs;
use std::{fs::remove_file, str::FromStr};
use tauri::{ipc::Response, Builder, Wry};
use tauri::{
    path::BaseDirectory, AppHandle, LogicalPosition, LogicalSize, Manager, State, WebviewUrl,
    Window,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tokio::sync::oneshot;
use uuid::Uuid;
use worker_adapter::{state::TranscribeTaskParameters, WorkerAdapter};

pub fn install_cmds(builder: Builder<Wry>) -> Builder<Wry> {
    builder.invoke_handler(tauri::generate_handler![
        get_documents,
        get_document,
        forget_document,
        read_automerge,
        append_automerge_change,
        transcribe_files,
        open_document_via_file_picker,
        save_document,
        save_document_as_dialog,
        open_document_window,
        show_new_transcript_dialog,
        toggle_devtools,
    ])
}

#[tauri::command]
pub fn get_documents(app_handle: AppHandle) -> CmdResult<Vec<FrontendDocument>> {
    Ok(app_handle
        .get_documents()?
        .iter()
        .map(Document::as_frontend_document)
        .rev()
        .collect())
}

#[tauri::command]
pub fn get_document(app_handle: AppHandle, id: Uuid) -> CmdResult<FrontendDocument> {
    Ok(app_handle.get_document(id)?.as_frontend_document())
}

/// this deletes the document from the list of recent documents.
/// If a transcription job is currently running for this document, it gets canceled.
/// If the document has unsaved changes, these get deleted, so in this case the frontend
/// should display a confirmation dialog.
#[tauri::command]
pub fn forget_document(
    app_handle: AppHandle,
    worker_adapter: State<'_, WorkerAdapter>,
    id: Uuid,
) -> CmdResult<()> {
    app_handle.update_documents(|mut documents| {
        if let Some(position) = documents.iter().position(|doc| doc.id == id) {
            let doc = documents.remove(position);
            for task in doc.worker_tasks {
                if let Err(e) = worker_adapter.tasks.blocking_lock().remove_task(task.id) {
                    warn!("could not remove task: {e}")
                }
            }
            remove_file(doc.app_data_path)?;
        }
        Ok(documents)
    })?;
    Ok(())
}

#[tauri::command]
pub fn read_automerge(app_handle: AppHandle, id: Uuid) -> CmdResult<Response> {
    Ok(tauri::ipc::Response::new(
        transcribee_archive::get_automerge_doc(&app_handle.get_document(id)?.app_data_path)?,
    ))
}

#[tauri::command]
pub fn append_automerge_change(
    app_handle: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> CmdResult<()> {
    let tauri::ipc::InvokeBody::Raw(change) = request.body() else {
        return Err(anyhow!("request body to append_automerge_change must be raw").into());
    };
    let Some(id) = request.headers().get("id") else {
        return Err(anyhow!("missing id for append_automerge_change").into());
    };
    let uuid = Uuid::from_str(id.to_str()?)?;
    let document = app_handle.get_document(uuid)?;
    transcribee_archive::append_automerge_change(&document.app_data_path, change)?;
    app_handle.update_document(uuid, |mut doc| {
        doc.has_unsaved_changes = true;
        doc
    })?;
    Ok(())
}

#[tauri::command]
pub async fn transcribe_files(
    app: AppHandle,
    worker_adapter: State<'_, WorkerAdapter>,
    media_file_paths: Vec<String>,
    language: String,
    model: String,
    speaker_detection: String,
    number_of_speakers: u32,
) -> CmdResult<()> {
    for f in media_file_paths {
        let document = app.create_new_document(f.clone())?;
        let mut tasks = vec![];
        let transcription_task = worker_adapter
            .start_transcription(
                document.id,
                f.clone(),
                TranscribeTaskParameters {
                    lang: language.clone(),
                    model: model.clone(),
                },
            )
            .await;
        tasks.push(transcription_task.clone());

        if speaker_detection != "off" {
            let number_of_speakers = if speaker_detection == "advanced" {
                Some(number_of_speakers)
            } else {
                None
            };
            let identify_speakers_task = worker_adapter
                .start_identify_speakers(
                    document.id,
                    f.clone(),
                    transcription_task.id,
                    number_of_speakers,
                )
                .await;
            tasks.push(identify_speakers_task);
        }

        let media_files_folder = app
            .path()
            .resolve("media_files", BaseDirectory::AppData)?
            .to_string_lossy()
            .to_string();
        fs::create_dir_all(&media_files_folder)?;
        let reencode_task = worker_adapter
            .start_reencode(document.id, f, media_files_folder)
            .await;
        tasks.push(reencode_task);

        app.update_document(document.id, |mut doc| {
            doc.worker_tasks.append(&mut tasks.clone());
            doc
        })?;
    }

    create_or_focus_main_window(&app).await?;
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
pub async fn save_document(app_handle: AppHandle, id: Uuid) -> CmdResult<()> {
    let document = app_handle.get_document(id)?;
    let Some(save_path) = &document.save_path else {
        return save_document_as_dialog(app_handle.clone(), id).await;
    };
    let media_file = get_document_media_for_save_or_display_error(&app_handle, &document).await?;
    let new_automerge_doc = transcribee_archive::get_automerge_doc(&document.app_data_path)?;
    if !fs::exists(save_path)? {
        warn!("save target file under {save_path} does not exist, even if we think it should. Recreating file...");
        transcribee_archive::create_new(save_path, Some(media_file), &new_automerge_doc)?;
    } else {
        if let Err(e) = transcribee_archive::update_automerge_file(save_path, &new_automerge_doc) {
            warn!("transcribee_archive::update_automerge_file failed with error {e}, trying to re-creating the file...");
            transcribee_archive::create_new(save_path, Some(media_file), &new_automerge_doc)?;
        }
    }
    app_handle.update_document(id, |mut doc| {
        doc.has_unsaved_changes = false;
        doc
    })?;
    Ok(())
}

#[tauri::command]
pub async fn save_document_as_dialog(app_handle: AppHandle, id: Uuid) -> CmdResult<()> {
    let document = app_handle.get_document(id)?;
    let media_file = get_document_media_for_save_or_display_error(&app_handle, &document).await?;

    let focused_window =
        focused_window(&app_handle).ok_or(anyhow!("could not get focused window"))?;
    let (tx, rx) = oneshot::channel();
    let default_filename = document
        .display_name()
        .rsplit_once(".")
        .map(|(basename, _suffix)| basename.to_string())
        .unwrap_or(document.display_name());
    tauri::async_runtime::spawn(async move {
        focused_window
            .dialog()
            .file()
            .add_filter("Transcribee Archive", &["transcribee"])
            .set_file_name(default_filename)
            .save_file(|f| {
                tx.send(f).unwrap();
            });
    });
    let Some(save_path) = rx.await? else {
        return Ok(());
    };

    let automerge_doc = transcribee_archive::get_automerge_doc(&document.app_data_path)?;
    transcribee_archive::create_new(&save_path.to_string(), Some(media_file), &automerge_doc)?;

    // kick out any other loaded documents with the same path to only ever have one document with
    // the same save path in transcribee desktop.
    app_handle.update_documents(|mut documents| {
        documents.retain(|doc| doc.save_path != Some(save_path.to_string()));
        Ok(documents)
    })?;

    app_handle.update_document(id, |mut doc| {
        doc.save_path = Some(save_path.to_string());
        doc.has_unsaved_changes = false;
        doc
    })?;
    Ok(())
}

pub async fn get_document_media_for_save_or_display_error(
    app_handle: &AppHandle,
    document: &Document,
) -> Result<MediaFileSource> {
    let Some(media_file) = document
        .media_files
        .iter()
        .find(|m| m.tags.iter().any(|t| t == "browser_compatible"))
    else {
        let focused_window =
            focused_window(app_handle).ok_or(anyhow!("could not get focused window"))?;
        focused_window
            .dialog()
            .message("Could not save, because the media file is still being processed. Please try again in a few seconds when transcribee has prepared a suitable file.")
            .kind(MessageDialogKind::Error)
            .title("Could Not Save")
            .show(|_result| {});
        return Err(anyhow!(
            "could not save because no suitable media file was found!"
        ));
    };

    Ok(media_file.source.clone())
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
