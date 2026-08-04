use anyhow::anyhow;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use uuid::Uuid;

use crate::file_handling::Document;

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

pub fn get_focused_document_id(app: &AppHandle) -> anyhow::Result<Uuid> {
    let webview = focused_window(app).ok_or(anyhow!("could not find focused window"))?;
    let uuid = Uuid::parse_str(
        webview
            .label()
            .strip_prefix("document/")
            .ok_or(anyhow!("focused window is not a document window"))?,
    )?;
    Ok(uuid)
}

pub async fn create_or_focus_document_window(
    app: &AppHandle,
    document: &Document,
    fullscreen: bool,
) -> tauri::Result<tauri::WebviewWindow> {
    create_or_focus_window(
        app,
        &format!("document/{}", document.id),
        WebviewUrl::App(format!("document/{}", document.id).into()),
        |builder| builder.inner_size(1200.0, 800.0).fullscreen(fullscreen),
    )
    .await
}
