use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
    Align,
    Reencode,
    Export,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TaskAttempt {
    progress: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MediaFile {
    tags: Vec<String>,
    path: String,
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
    pub fn new(name: String, media_files: Vec<MediaFile>) -> Self {
        Document {
            id: Uuid::new_v4(),
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
#[serde(untagged)]
pub enum TaskParameters {
    NoParameters(HashMap<(), ()>),
    Transcribe(TranscribeTaskParameters),
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

pub type ChangeListener = Arc<Mutex<dyn FnMut(Uuid, &[u8]) + Send + Sync>>;

#[derive(Default, Clone)]
pub struct ListenersContainer {
    pub document_listeners: Vec<ChangeListener>,
}

impl ListenersContainer {
    pub fn add_document_listener(
        &mut self,
        listener: impl FnMut(Uuid, &[u8]) + Send + Sync + 'static,
    ) -> ChangeListener {
        let listener = Arc::new(Mutex::new(listener));
        self.document_listeners.push(listener.clone());
        listener
    }

    pub fn remove_document_listener(&mut self, listener: ChangeListener) {
        self.document_listeners
            .retain(|l| !Arc::ptr_eq(l, &listener));
    }

    pub async fn notify_document_listeners(&mut self, document_id: Uuid, change: &[u8]) {
        for listener in &self.document_listeners {
            let mut listener = listener.lock().await;
            listener(document_id, change);
        }
    }
}

#[derive(Default, Clone, Debug)]
pub struct TasksContainer {
    tasks: HashMap<Uuid, Task>,
}

impl TasksContainer {
    pub fn add_task(&mut self, task: Task) {
        self.tasks.insert(task.id, task);
    }

    pub fn complete_task(&mut self, id: Uuid) {
        self.tasks.entry(id).and_modify(|t| {
            t.state = TaskState::Completed;
        });
    }

    pub fn fail_task(&mut self, id: Uuid) {
        self.tasks.entry(id).and_modify(|t| {
            t.state = TaskState::Failed;
        });
    }

    pub fn update_task_attempt(&mut self, task_id: Uuid, attempt: TaskAttempt) {
        self.tasks.entry(task_id).and_modify(|t| {
            t.current_attempt = Some(attempt);
        });
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
