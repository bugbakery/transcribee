use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Wry,
};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct BeforeExitState {
    pub before_exit_listeners: Mutex<Vec<Box<dyn FnOnce() + Send + Sync>>>,
}

pub type ListenerHandle = usize;

impl BeforeExitState {
    pub async fn before_exit(&self, func: Box<dyn FnOnce() + Send + Sync>) -> ListenerHandle {
        let mut listeners = self.before_exit_listeners.lock().await;
        let handle =
            func.as_ref() as *const (dyn FnOnce() + Send + Sync) as *const () as ListenerHandle;
        listeners.push(func);
        handle
    }

    pub async fn unregister_before_exit(&self, handle: ListenerHandle) {
        let mut listeners = self.before_exit_listeners.lock().await;
        listeners.retain(|l| {
            let candidate =
                l.as_ref() as *const (dyn FnOnce() + Send + Sync) as *const () as ListenerHandle;
            candidate != handle
        });
    }

    pub async fn handle_exit(&self) {
        let mut listeners = self.before_exit_listeners.lock().await;
        for listener in listeners.drain(..) {
            listener();
        }
    }
}

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("before-exit")
        .setup(move |app, _| {
            let app = app.clone();
            app.manage(BeforeExitState::default());
            Ok(())
        })
        .build()
}
