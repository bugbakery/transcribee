use crate::WorkerAdapter;
use crate::state::{MediaFile, Task, TaskAttempt, TaskNotFoundError, TaskType};
use crate::sync_message::SyncMessage;
use axum::extract::ws::Message;
use axum::extract::{Path, State};
use axum::{
    Json,
    body::Bytes,
    extract::{ConnectInfo, WebSocketUpgrade, ws::WebSocket},
    response::{IntoResponse, Result},
};
use axum_extra::extract::Query;
use futures_util::stream::StreamExt;
use serde::Deserialize;
use std::net::SocketAddr;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct GetUnassingedTaskQuery {
    #[serde(rename = "task_type")]
    task_types: Vec<TaskType>,
}

pub async fn claim_unassigned_task(
    State(app_state): State<WorkerAdapter>,
    Query(query): Query<GetUnassingedTaskQuery>,
) -> Json<Option<Task>> {
    let mut tasks = app_state.tasks.lock().await;
    let task = tasks.claim_unassigned_task(&query.task_types);
    if let Some(task) = &task {
        let mut progress_listeners = app_state.progress_listeners.lock().await;
        progress_listeners
            .notify_listeners(task.document.id, ())
            .await;
    }
    Json(task)
}

pub async fn mark_completed(
    State(app_state): State<WorkerAdapter>,
    Path(task_id): Path<Uuid>,
) -> Result<Json<()>> {
    let mut tasks = app_state.tasks.lock().await;
    let document_uuid = tasks.get(&task_id).ok_or(TaskNotFoundError)?.document.id;
    tasks.complete_task(task_id)?;
    let mut progress_listeners = app_state.progress_listeners.lock().await;
    progress_listeners.notify_listeners(document_uuid, ()).await;
    Ok(Json(()))
}

pub async fn mark_failed(
    State(app_state): State<WorkerAdapter>,
    Path(task_id): Path<Uuid>,
) -> Result<Json<()>> {
    let mut tasks = app_state.tasks.lock().await;
    tasks.fail_task(task_id)?;
    Ok(Json(()))
}

pub async fn keepalive(
    State(app_state): State<WorkerAdapter>,
    Path(task_id): Path<Uuid>,
    Json(payload): Json<TaskAttempt>,
) -> Result<Json<()>> {
    let mut tasks = app_state.tasks.lock().await;
    let document_uuid = tasks.get(&task_id).ok_or(TaskNotFoundError)?.document.id;
    tasks.update_task_attempt(task_id, payload.clone())?;
    let mut progress_listeners = app_state.progress_listeners.lock().await;
    progress_listeners.notify_listeners(document_uuid, ()).await;
    Ok(Json(()))
}

pub async fn add_media_file(
    State(app_state): State<WorkerAdapter>,
    Path(document_id): Path<Uuid>,
    Json(payload): Json<MediaFile>,
) -> Result<Json<()>> {
    let mut media_file_listeners = app_state.media_file_listeners.lock().await;
    media_file_listeners
        .notify_listeners(document_id, payload)
        .await;
    Ok(Json(()))
}

pub async fn noop(body: Bytes) -> Json<()> {
    log::debug!("noop req: {:?}", body);
    Json(())
}

async fn handle_document_sync_socket(
    app_state: WorkerAdapter,
    mut socket: WebSocket,
    who: SocketAddr,
    document_id: Uuid,
) {
    log::debug!("ws: client {who} upgraded");

    socket
        .send(SyncMessage::FullDocument(&[]).into())
        .await
        .unwrap();
    socket
        .send(SyncMessage::ChangeBacklogComplete.into())
        .await
        .unwrap();

    let (_, mut receiver) = socket.split();

    while let Some(msg) = receiver.next().await {
        if let Ok(msg) = msg {
            match msg {
                Message::Binary(change) => {
                    let mut automerge_listeners = app_state.automerge_listeners.lock().await;
                    automerge_listeners
                        .notify_listeners(document_id, change.to_vec())
                        .await;
                }
                Message::Close(close_frame_opt) => {
                    log::debug!("ws: client {who} closed connection {:?}", close_frame_opt);
                }
                _ => {}
            }
        } else {
            log::warn!("ws: client {who} abruptly disconnected");
            break;
        }
    }
}

pub async fn document_sync(
    State(app_state): State<WorkerAdapter>,
    ws: WebSocketUpgrade,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(document_id): Path<Uuid>,
) -> impl IntoResponse {
    log::debug!("ws: client {addr} connected from");
    ws.on_upgrade(move |socket| handle_document_sync_socket(app_state, socket, addr, document_id))
}
