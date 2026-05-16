use axum::Json;
use axum::extract::State;
use axum::routing::post;
use axum::{Router, routing::get};
use axum_extra::extract::Query;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
enum TaskState {
    NEW,
    ASSIGNED,
    COMPLETED,
    FAILED,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum TaskType {
    IdentifySpeakers,
    Transcribe,
    Align,
    Reencode,
    Export,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct TaskAttempt {
    progress: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Task {
    id: Uuid,
    task_type: TaskType,
    state: TaskState,
    dependencies: Vec<Uuid>,
    current_attempt: Option<TaskAttempt>,
}

#[derive(Clone, Debug, Serialize)]
struct BackendState {
    documents: HashMap<Uuid, Vec<u8>>,
    tasks: HashMap<Uuid, Task>,
}

#[derive(Clone, Debug, Serialize)]
struct ApiState {
    token: String,
    state: Arc<Mutex<BackendState>>,
}

impl BackendState {
    fn add_task(&mut self, task: Task) {
        self.tasks.insert(task.id, task);
    }
}

#[derive(Deserialize)]
struct GetUnassingedTaskQuery {
    #[serde(rename = "task_type")]
    task_types: Vec<TaskType>,
}

fn get_ready_task(tasks: &HashMap<Uuid, Task>, task_types: &[TaskType]) -> Option<Uuid> {
    'task_loop: for task in tasks.values() {
        if !task_types.contains(&task.task_type) {
            continue;
        }
        for dependency in &task.dependencies {
            if let Some(dep_task) = tasks.get(dependency)
                && dep_task.state != TaskState::COMPLETED
            {
                continue 'task_loop;
            }
        }
        if task.current_attempt.is_some() || task.state != TaskState::NEW {
            continue;
        }
        return Some(task.id);
    }
    None
}

async fn claim_unassigned_task(
    State(state): State<ApiState>,
    Query(query): Query<GetUnassingedTaskQuery>,
) -> Json<Option<Task>> {
    let mut state = state.state.lock().unwrap();
    if let Some(task_id) = get_ready_task(&state.tasks, &query.task_types) {
        let task = state.tasks.get_mut(&task_id).unwrap();
        (*task).current_attempt = Some(TaskAttempt { progress: None });
        (*task).state = TaskState::ASSIGNED;
        return Json(Some(task.clone()));
    }
    return Json(None);
}

async fn noop() -> Json<()> {
    Json(())
}
async fn dump_state(State(state): State<ApiState>) -> Json<BackendState> {
    return Json(state.state.lock().unwrap().clone());
}

pub struct BackendBuilder {
    port: Option<u16>,
    listener: Option<std::net::TcpListener>,
    token: Option<String>,
    state: Arc<Mutex<BackendState>>,
}

impl BackendBuilder {
    pub fn new() -> Self {
        return BackendBuilder {
            port: None,
            listener: None,
            token: None,
            state: Arc::new(Mutex::new(BackendState {
                documents: HashMap::new(),
                tasks: HashMap::new(),
            })),
        };
    }
    pub fn with_token(mut self, token: String) -> Self {
        self.token = Some(token.clone());
        self
    }
    pub fn with_port(mut self, port: u16) -> Self {
        self.port = Some(port);
        self
    }
    pub fn bind(&mut self) -> std::io::Result<SocketAddr> {
        let listener = std::net::TcpListener::bind(SocketAddrV4::new(
            Ipv4Addr::new(127, 0, 0, 1),
            self.port.unwrap_or(0),
        ))?;
        listener.set_nonblocking(true)?;
        let addr = listener.local_addr();
        self.listener = Some(listener);
        addr
    }

    pub async fn serve(self) -> std::io::Result<()> {
        let service = self.get_router();
        let listener = tokio::net::TcpListener::from_std(self.listener.unwrap())?;
        axum::serve(listener, service).await
    }

    fn get_router(&self) -> Router {
        self.state.lock().unwrap().add_task(Task {
            id: Uuid::new_v4(),
            task_type: TaskType::Reencode,
            state: TaskState::NEW,
            dependencies: Vec::new(),
            current_attempt: None,
        });
        let state = ApiState {
            token: self.token.clone().unwrap(),
            state: self.state.clone(),
        };
        let app = Router::new()
            .route("/", get(dump_state))
            .route(
                "/api/v1/tasks/claim_unassigned_task/",
                post(claim_unassigned_task),
            )
            .route("/api/v1/tasks/{task_id}/keepalive/", post(noop))
            .with_state(state);
        // f"documents/{task.document.id}/add_media_file/",
        // self.api_client.post(url=f"tasks/{task_id}/mark_completed/", json=body)
        // self.api_client.post(url=f"tasks/{task_id}/mark_failed/", json=body)
        // self.api_client.post(f"tasks/{task_id}/keepalive/", json=body)

        return app;
    }
}
