use axum::Json;
use axum::extract::State;
use axum::response::IntoResponse;
use axum::{Router, routing::get};
use serde::Serialize;
use std::collections::HashMap;
use std::net::SocketAddr;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
struct Task {
    // id: uuid.UUID
    // state: TaskState
    // dependencies: List[uuid.UUID]
    // current_attempt: Optional[TaskAttemptResponse]
}

#[derive(Clone, Debug, Serialize)]
struct ApiState {
    token: String,
    documents: HashMap<Uuid, Vec<u8>>,
    tasks: HashMap<Uuid, Task>,
}

pub struct Backend {
    listener: Option<std::net::TcpListener>,
    token: Option<String>,
}

async fn list_tasks(State(state): State<ApiState>) -> impl IntoResponse {
    Json(state.tasks)
}

impl Backend {
    pub fn new() -> Self {
        return Backend {
            listener: None,
            token: None,
        };
    }
    pub fn bind(&mut self) -> std::io::Result<SocketAddr> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
        listener.set_nonblocking(true)?;
        let addr = listener.local_addr();
        self.listener = Some(listener);
        addr
    }
    pub fn with_token(mut self, token: String) -> Self {
        self.token = Some(token);
        self
    }

    pub async fn serve(self) -> std::io::Result<()> {
        let service = self.get_router();
        let listener = tokio::net::TcpListener::from_std(self.listener.unwrap())?;
        axum::serve(listener, service).await
    }

    fn get_router(&self) -> Router {
        let app = Router::new()
            .route("/", get(async |State(state): State<ApiState>| Json(state)))
            .route("/api/v1/tasks", get(list_tasks))
            .with_state(ApiState {
                token: self.token.clone().unwrap(),
                documents: HashMap::new(),
                tasks: HashMap::new(),
            });
        // tasks/claim_unassigned_task/
        // tasks/{task_id}/keepalive/
        // f"documents/{task.document.id}/add_media_file/",
        // self.api_client.post(url=f"tasks/{task_id}/mark_completed/", json=body)
        // self.api_client.post(url=f"tasks/{task_id}/mark_failed/", json=body)
        // self.api_client.post(f"tasks/{task_id}/keepalive/", json=body)

        return app;
    }
}
