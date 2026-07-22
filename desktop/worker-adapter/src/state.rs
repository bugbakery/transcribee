use serde::{Deserialize, Serialize, Serializer};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use uuid::Uuid;

pub static BACKEND_STATE: LazyLock<Mutex<BackendState>> = LazyLock::new(|| {
    Mutex::new(BackendState {
        documents: HashMap::new(),
        tasks: HashMap::new(),
    })
});

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

fn get_document<S>(doc_uuid: &Uuid, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    return BACKEND_STATE
        .lock()
        .unwrap()
        .documents
        .get(doc_uuid)
        .serialize(serializer);
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub enum TaskParameters {
    NoParameters(HashMap<(), ()>),
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Task {
    pub id: Uuid,
    pub task_type: TaskType,
    pub state: TaskState,
    pub dependencies: Vec<Uuid>,
    pub current_attempt: Option<TaskAttempt>,
    #[serde(serialize_with = "get_document")]
    pub document: Uuid,
    pub task_parameters: TaskParameters,
}

#[derive(Clone, Debug, Serialize)]
pub struct BackendState {
    documents: HashMap<Uuid, Document>,
    tasks: HashMap<Uuid, Task>,
}

impl BackendState {
    pub fn add_task(&mut self, task: Task) {
        self.tasks.insert(task.id, task);
    }
    pub fn add_document(&mut self, document: Document) {
        self.documents.insert(document.id, document);
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
            (*task).current_attempt = Some(TaskAttempt { progress: None });
            (*task).state = TaskState::Assigned;
            return Some(task.clone());
        }
        return None;
    }
}
