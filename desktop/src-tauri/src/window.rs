use std::{fs::File, io::Write, path::PathBuf};

use anyhow::Result;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use worker_adapter::WorkerAdapter;

use crate::{
    file_handling::{get_media_files_folder, Document},
    range_util::RangeChunks,
    transcribee_archive::MediaFileSource,
};

// this is async since this would deadlock in synchronous commands or event handlers on windows
// (see https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html#known-issues)
pub async fn create_or_focus_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    url: WebviewUrl,
    customize: impl Fn(WebviewWindowBuilder<R, AppHandle<R>>) -> WebviewWindowBuilder<R, AppHandle<R>>,
) -> tauri::Result<WebviewWindow<R>> {
    let existing_window = app.get_webview_window(label);
    if let Some(existing_window) = existing_window {
        existing_window.show()?;
        existing_window.set_focus()?;
        Ok(existing_window)
    } else {
        let builder = WebviewWindowBuilder::new(app, label, url)
            .on_document_title_changed(|window, title| {
                window.set_title(&title).unwrap();
            })
            .visible(false)
            .initialization_script(
                r#"
                window.__SHOW_WINDOW_WHEN_READY__ = true;
            "#,
            );
        customize(builder).build()
    }
}

pub async fn create_or_focus_main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    create_or_focus_window(app, "main", WebviewUrl::App("".into()), |buider| {
        buider.inner_size(800.0, 600.0)
    })
    .await
}

pub fn focused_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false))
}

async fn generate_waveform_if_needed(app: &AppHandle, document: &Document) -> Result<()> {
    if document
        .media_files
        .iter()
        .find(|m| m.tags.contains(&"waveform".to_string()))
        .is_some()
    {
        return Ok(());
    }

    let media_files_folder = get_media_files_folder(app)?;

    let media_file = document
        .media_files
        .iter()
        // prefer existing media file over extracting from tar
        .find(|m| matches!(m.source, MediaFileSource::Fs { .. }))
        .cloned()
        .or_else(|| document.media_files.first().cloned());

    if let Some(media_file) = media_file {
        let file_path = match &media_file.source {
            MediaFileSource::Fs { media_path } => media_path.clone(),
            source @ MediaFileSource::InTar { .. } => {
                let path = PathBuf::from_iter([
                    &media_files_folder,
                    &format!("{}_extracted ", document.id),
                ]);
                let mut file = File::create_new(&path)?;
                for chunk in (0..source.len()?).chunks(10_000_000) {
                    let buf = source.get_bytes(chunk.clone())?;
                    file.write_all(&buf)?;
                }
                path.to_string_lossy().to_string()
            }
        };

        let worker = app.state::<WorkerAdapter>();
        worker
            .start_reencode(
                document.id,
                file_path,
                media_files_folder,
                vec![],
                true,
                false,
            )
            .await;

        // TODO: delete extracted file when task is done
    }

    Ok(())
}

pub async fn create_or_focus_document_window(
    app: &AppHandle,
    document: &Document,
    fullscreen: bool,
) -> tauri::Result<tauri::WebviewWindow> {
    let app_clone = app.clone();
    let document_clone: Document = document.clone();
    tauri::async_runtime::spawn(async move {
        generate_waveform_if_needed(&app_clone, &document_clone).await
    });

    create_or_focus_window(
        app,
        &format!("document/{}", document.id),
        WebviewUrl::App(format!("document/{}", document.id).into()),
        |builder| builder.inner_size(1200.0, 800.0).fullscreen(fullscreen),
    )
    .await
}
