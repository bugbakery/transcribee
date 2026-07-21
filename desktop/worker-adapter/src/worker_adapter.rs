use axum::Router;
use axum::extract::{Query, Request, State};
use axum::http::{StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::{any, post};
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener};
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::trace::{DefaultMakeSpan, TraceLayer};
use tracing::metadata::Level;
use uuid::Uuid;

use crate::handlers::{
    claim_unassigned_task, document_sync, keepalive, mark_completed, mark_failed, noop,
};
use crate::state::{
    ChangeListener, Document, ListenersContainer, MediaFile, Task, TaskParameters, TaskState,
    TaskType, TasksContainer, TranscribeTaskParameters,
};

async fn worker_auth(
    State(state): State<WorkerAdapter>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|header| header.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    if state.check_auth_header(auth_header) {
        Ok(next.run(req).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

async fn worker_ws_auth(
    State(state): State<WorkerAdapter>,
    Query(params): Query<HashMap<String, String>>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_param = params
        .get("authorization")
        .ok_or(StatusCode::UNAUTHORIZED)?;
    if state.check_auth_header(auth_param.as_str()) {
        Ok(next.run(req).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

#[derive(Clone)]
pub struct WorkerAdapter {
    token: String,
    pub(crate) tasks: Arc<Mutex<TasksContainer>>,
    pub(crate) listeners: Arc<Mutex<ListenersContainer>>,
}

impl WorkerAdapter {
    pub fn new(token: String) -> WorkerAdapter {
        let tasks: Arc<Mutex<TasksContainer>> = Default::default();
        let listeners: Arc<Mutex<ListenersContainer>> = Default::default();

        WorkerAdapter {
            token: token.clone(),
            listeners: listeners.clone(),
            tasks: tasks.clone(),
        }
    }

    fn check_auth_header(&self, header: &str) -> bool {
        header == format!("Worker {}", self.token)
    }

    pub async fn start_transcription(&self, file_path: String, params: TranscribeTaskParameters) {
        let mut tasks = self.tasks.lock().await;
        let media_file = MediaFile::new(file_path.clone());
        let doc = Document::new(file_path, vec![media_file]);

        tasks.add_task(Task {
            id: Uuid::new_v4(),
            current_attempt: None,
            dependencies: vec![],
            state: TaskState::New,
            task_parameters: TaskParameters::Transcribe(params),
            document: doc,
            task_type: TaskType::Transcribe,
        });
    }

    pub async fn add_change_listener(
        &self,
        listener: impl FnMut(Uuid, &[u8]) + Send + Sync + 'static,
    ) -> ChangeListener {
        let mut listeners = self.listeners.lock().await;
        listeners.add_document_listener(listener)
    }

    pub async fn remove_change_listener(&self, listener: ChangeListener) {
        let mut listeners = self.listeners.lock().await;
        listeners.remove_document_listener(listener);
    }

    pub fn bind(port: Option<u16>) -> std::io::Result<TcpListener> {
        let listener = TcpListener::bind(SocketAddrV4::new(
            Ipv4Addr::new(127, 0, 0, 1),
            port.unwrap_or(0),
        ))?;
        listener.set_nonblocking(true)?;
        Ok(listener)
    }

    pub async fn serve(&self, listener: TcpListener) -> std::io::Result<()> {
        let listener = tokio::net::TcpListener::from_std(listener)?;

        let service = self.get_router();
        axum::serve(
            listener,
            service.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
    }

    fn get_router(&self) -> Router {
        let http_router = Router::<WorkerAdapter>::new()
            .route(
                "/api/v1/tasks/claim_unassigned_task/",
                post(claim_unassigned_task),
            )
            .route("/api/v1/tasks/{task_id}/keepalive/", post(keepalive))
            .route(
                "/api/v1/tasks/{task_id}/mark_completed/",
                post(mark_completed),
            )
            .route("/api/v1/tasks/{task_id}/mark_failed/", post(mark_failed))
            .route("/api/v1/documents/{document_id}/set_duration/", post(noop))
            .route(
                "/api/v1/documents/{document_id}/add_media_file/",
                post(noop),
            )
            .route_layer(middleware::from_fn_with_state(self.clone(), worker_auth));

        let ws_router = Router::<WorkerAdapter>::new()
            .route("/api/v1/documents/sync/{document_id}/", any(document_sync))
            .route_layer(middleware::from_fn_with_state(
                self.clone(),
                worker_ws_auth,
            ));

        let app = Router::<WorkerAdapter>::new()
            .merge(http_router)
            .merge(ws_router)
            .layer(
                TraceLayer::new_for_http().make_span_with(
                    DefaultMakeSpan::default()
                        .level(Level::TRACE)
                        .include_headers(true),
                ),
            )
            .with_state(self.clone());

        return app;
    }
}
