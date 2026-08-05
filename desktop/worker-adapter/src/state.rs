use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::error::Error;
use std::fmt::Display;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskState {
    New,
    Assigned,
    Completed,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskType {
    IdentifySpeakers,
    Transcribe,
    Reencode,
    Export,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TaskAttempt {
    pub progress: Option<f32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MediaFile {
    pub tags: Vec<String>,
    pub path: String,
}

impl MediaFile {
    pub fn new(path: String) -> Self {
        MediaFile {
            tags: Vec::new(),
            path,
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Document {
    pub id: uuid::Uuid,
    pub name: String,
    pub created_at: chrono::DateTime<chrono::Local>,
    pub changed_at: chrono::DateTime<chrono::Local>,
    pub media_files: Vec<MediaFile>,
}

impl Document {
    pub fn new(name: String, media_files: Vec<MediaFile>, uuid: Uuid) -> Self {
        Document {
            id: uuid,
            name,
            created_at: chrono::Local::now(),
            changed_at: chrono::Local::now(),
            media_files,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TranscribeTaskParameters {
    pub lang: String,
    pub model: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct IdentifySpeakersTaskParameters {
    pub number_of_speakers: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ReencodeTaskParameters {
    pub output_path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub enum TaskParameters {
    NoParameters(HashMap<(), ()>),
    Transcribe(TranscribeTaskParameters),
    IdentifySpeakers(IdentifySpeakersTaskParameters),
    Reencode(ReencodeTaskParameters),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Task {
    pub id: Uuid,
    pub task_type: TaskType,
    pub state: TaskState,
    pub dependencies: Vec<Uuid>,
    pub current_attempt: Option<TaskAttempt>,
    pub document: Document,
    pub task_parameters: TaskParameters,
}

#[derive(Clone)]
pub struct ListenersContainer<T> {
    pub listeners: Vec<Arc<Mutex<dyn FnMut(Uuid, T) + Send + Sync>>>,
}
impl<T> Default for ListenersContainer<T> {
    fn default() -> Self {
        Self {
            listeners: Default::default(),
        }
    }
}

impl<T: Clone> ListenersContainer<T> {
    pub fn add_listener(
        &mut self,
        listener: impl FnMut(Uuid, T) + Send + Sync + 'static,
    ) -> Arc<Mutex<dyn FnMut(Uuid, T) + Send + Sync>> {
        let listener = Arc::new(Mutex::new(listener));
        self.listeners.push(listener.clone());
        listener
    }

    pub fn remove_listener(&mut self, listener: Arc<Mutex<dyn FnMut(Uuid, T) + Send + Sync>>) {
        self.listeners.retain(|l| !Arc::ptr_eq(l, &listener));
    }

    pub async fn notify_listeners(&mut self, uuid: Uuid, x: T) {
        for listener in &self.listeners {
            let mut listener = listener.lock().await;
            listener(uuid, x.clone());
        }
    }
}

#[derive(Default, Clone, Debug)]
pub struct TasksContainer {
    tasks: HashMap<Uuid, Task>,
}

#[derive(Debug)]
pub struct TaskNotFoundError;
impl Display for TaskNotFoundError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TaskNotFoundError")
    }
}
impl Error for TaskNotFoundError {}
impl IntoResponse for TaskNotFoundError {
    fn into_response(self) -> axum::response::Response {
        (StatusCode::NOT_FOUND, "task not found").into_response()
    }
}

impl TasksContainer {
    pub fn add_task(&mut self, task: Task) -> Task {
        self.tasks.insert(task.id, task.clone());
        task
    }

    pub fn complete_task(&mut self, id: Uuid) -> Result<(), TaskNotFoundError> {
        match self.tasks.get_mut(&id) {
            Some(task) => {
                task.state = TaskState::Completed;
                Ok(())
            }
            None => Err(TaskNotFoundError),
        }
    }

    pub fn remove_task(&mut self, id: Uuid) -> Result<(), TaskNotFoundError> {
        match self.tasks.remove(&id) {
            Some(_) => Ok(()),
            None => Err(TaskNotFoundError),
        }
    }

    pub fn fail_task(&mut self, id: Uuid) -> Result<(), TaskNotFoundError> {
        match self.tasks.get_mut(&id) {
            Some(task) => {
                task.state = TaskState::Failed;
                Ok(())
            }
            None => Err(TaskNotFoundError),
        }
    }

    pub fn update_task_attempt(
        &mut self,
        task_id: Uuid,
        attempt: TaskAttempt,
    ) -> Result<(), TaskNotFoundError> {
        match self.tasks.get_mut(&task_id) {
            Some(task) => {
                task.current_attempt = Some(attempt);
                Ok(())
            }
            None => Err(TaskNotFoundError),
        }
    }

    fn get_ready_task<'a>(&'a mut self, task_types: &[TaskType]) -> Option<&'a mut Task> {
        let uncompleted_tasks: Vec<Uuid> = self
            .tasks
            .values()
            .filter(|t| t.state != TaskState::Completed)
            .map(|x| x.id)
            .collect();
        'task_loop: for task in self.tasks.values_mut() {
            if !task_types.contains(&task.task_type) {
                continue;
            }
            for dependency in &task.dependencies {
                if uncompleted_tasks.contains(dependency) {
                    continue 'task_loop;
                }
            }
            if task.current_attempt.is_some() || task.state != TaskState::New {
                continue;
            }
            return Some(task);
        }
        None
    }
    pub fn claim_unassigned_task(&mut self, task_types: &[TaskType]) -> Option<Task> {
        if let Some(task) = self.get_ready_task(task_types) {
            task.current_attempt = Some(TaskAttempt { progress: None });
            task.state = TaskState::Assigned;
            return Some(task.clone());
        }
        None
    }
}
