use std::{collections::HashMap, env::temp_dir, fs, io::Write};

use anyhow::{Context, Ok, Result};
use futures::StreamExt;
use reqwest::{Client, RequestBuilder, StatusCode};
use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};
use uuid::Uuid;

pub struct TranscribeeWorkerApiClient {
    client: Client,
    base_url: String,
    token: String,
}
impl TranscribeeWorkerApiClient {
    pub fn new(base_url: &str, token: &str) -> Self {
        let client = Client::new();
        TranscribeeWorkerApiClient {
            client,
            base_url: base_url.trim_start_matches("/").to_string(),
            token: token.to_string(),
        }
    }

    pub async fn claim_unassigned_task(&self) -> Result<Option<Task>> {
        let result = self
            .post("/api/v1/tasks/claim_unassigned_task/?task_type=TRANSCRIBE")
            .send()
            .await?;
        let result = result.error_for_status()?;
        let json = result.json().await?;
        Ok(json)
    }

    /// returns if the task should continue
    pub async fn task_keepalive(&self, task_id: &Uuid, progress: &TaskProgress) -> Result<bool> {
        let result = self
            .post(&format!("/api/v1/tasks/{task_id}/keepalive/"))
            .json(progress)
            .send()
            .await?;
        if result.status() == StatusCode::NOT_FOUND {
            return Ok(false);
        }
        result.error_for_status()?;
        Ok(true)
    }

    pub async fn task_mark_completed(&self, task_id: &Uuid) -> Result<()> {
        let result = self
            .post(&format!("/api/v1/tasks/{task_id}/mark_completed/"))
            .json(&serde_json::json!({}))
            .send()
            .await?;
        result.error_for_status()?;
        Ok(())
    }

    pub async fn task_mark_failed(&self, task_id: &Uuid) -> Result<()> {
        let result = self
            .post(&format!("/api/v1/tasks/{task_id}/mark_failed/"))
            .json(&serde_json::json!({}))
            .send()
            .await?;
        result.error_for_status()?;
        Ok(())
    }

    fn post(&self, api_route: &str) -> RequestBuilder {
        self.client
            .post(format!("{}{}", self.base_url, api_route))
            .header("authorization", format!("Worker {}", self.token))
    }

    pub async fn get_media(&self, m: &MediaFile) -> Result<MediaFileGuard> {
        match m {
            MediaFile::Local { path, .. } => Ok(MediaFileGuard {
                path: path.clone(),
                delete_on_drop: false,
            }),
            MediaFile::Remote { url, .. } => {
                let filename = url
                    .rsplit_once("/")
                    .map(|(_, x)| {
                        if let Some((x, _)) = x.split_once("?") {
                            x.to_string()
                        } else {
                            x.to_string()
                        }
                    })
                    .unwrap_or_else(|| uuid::Uuid::now_v7().to_string());
                let path = temp_dir().join(filename).to_string_lossy().to_string();

                let res = reqwest::get(url).await?;
                let mut file = fs::File::create(&path)
                    .with_context(|| format!("Failed to create file '{path:?}'"))?;

                let mut stream = res.bytes_stream();
                while let Some(item) = stream.next().await {
                    let chunk = item.context("Error while downloading file")?;
                    file.write_all(&chunk)
                        .context("Error while writing to file")?;
                }

                Ok(MediaFileGuard {
                    path,
                    delete_on_drop: true,
                })
            }
        }
    }

    pub async fn get_websocket(
        &self,
        document: &Document,
    ) -> Result<WebSocketStream<MaybeTlsStream<TcpStream>>> {
        let (ws_stream, _) = connect_async(format!(
            "{}/api/v1/documents/sync/{}/?authorization={}",
            self.base_url.replace("http://", "ws://"),
            document.id,
            format_args!("Worker%20{}", self.token)
        ))
        .await?;
        Ok(ws_stream)
    }
}

pub struct MediaFileGuard {
    pub path: String,
    delete_on_drop: bool,
}
impl Drop for MediaFileGuard {
    fn drop(&mut self) {
        if self.delete_on_drop {
            fs::remove_file(&self.path).unwrap();
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TaskProgress {
    pub step: String,
    pub progress: Option<f32>,
    pub extra_data: serde_json::Value,
    pub timestamp: chrono::DateTime<chrono::Local>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskState {
    New,
    Assigned,
    Completed,
    Failed,
    Aborted,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskType {
    IdentifySpeakers,
    Transcribe,
    Reencode,
    Export,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
pub struct TaskAttempt {
    pub progress: Option<f32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub enum MediaFile {
    Local {
        tags: Vec<String>,
        path: String,
    },
    Remote {
        tags: Vec<String>,
        url: String,
        content_type: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Document {
    pub id: uuid::Uuid,
    pub name: String,
    pub created_at: chrono::DateTime<chrono::Local>,
    pub changed_at: chrono::DateTime<chrono::Local>,
    pub media_files: Vec<MediaFile>,
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
