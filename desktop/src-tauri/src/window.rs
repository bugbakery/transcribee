use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::file_handling::Document;

pub fn create_or_focus_window<R: Runtime>(
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

pub fn create_or_focus_main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    create_or_focus_window(app, "main", WebviewUrl::App("".into()), |buider| {
        buider.inner_size(800.0, 600.0)
    })
}

pub fn focused_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let windows = app.webview_windows();

    windows
        .iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|entry| entry.1.clone())
}

pub fn create_or_focus_document_window(
    app: &AppHandle,
    document: &Document,
    fullscreen: bool,
) -> tauri::Result<tauri::WebviewWindow> {
    let label_name: String = document
        .display_name()
        .replace(|c: char| !c.is_alphanumeric() && !"-/:_".contains(c), "_");

    create_or_focus_window(
        app,
        &format!("document/{label_name}"),
        WebviewUrl::App(format!("document/{}", document.id).into()),
        |builder| builder.inner_size(1200.0, 800.0).fullscreen(fullscreen),
    )
}
