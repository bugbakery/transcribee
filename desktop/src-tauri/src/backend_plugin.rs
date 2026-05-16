use std::net::SocketAddr;

use desktop_backend::Backend;

use tauri::Manager;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};
use tauri_plugin_log::log;

struct BackendState {
    local_addr: SocketAddr,
    token: String,
}
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("transcribee_backend")
        .setup(|app, _api| {
            let token = "SECRET_TOKEN".to_string(); // TODO: generate random token
            let mut backend = Backend::new().with_token(token.clone());
            let local_addr = backend.bind().unwrap();
            log::info!("starting backend on http://{:?}", local_addr);

            app.manage(BackendState { local_addr, token });
            tauri::async_runtime::spawn(async move { backend.serve().await });
            Ok(())
        })
        .build()
}
