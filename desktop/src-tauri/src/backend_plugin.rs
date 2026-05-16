use crate::backend::Backend;

use tauri::Manager;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};
use tauri_plugin_log::log;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("transcribee_backend")
        .setup(|app, _api| {
            let mut backend = Backend::new();
            let local_addr = backend.bind().unwrap();
            log::info!("starting backend on http://{:?}", local_addr);

            app.manage(local_addr);
            tauri::async_runtime::spawn(async move { backend.serve().await });
            Ok(())
        })
        .build()
}
