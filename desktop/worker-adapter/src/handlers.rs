use std::net::SocketAddr;

use crate::WorkerAdapter;
use crate::state::{Task, TaskAttempt, TaskType};
use crate::sync_message::SyncMessage;
use axum::extract::ws::Message;
use axum::extract::{Path, State};
use axum::{
    Json,
    body::Bytes,
    extract::{ConnectInfo, WebSocketUpgrade, ws::WebSocket},
    response::IntoResponse,
};
use axum_extra::extract::Query;
use futures_util::stream::StreamExt;
use serde::Deserialize;
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
    Json(tasks.claim_unassigned_task(&query.task_types))
}

pub async fn mark_completed(
    State(app_state): State<WorkerAdapter>,
    Path(task_id): Path<Uuid>,
) -> Json<()> {
    let mut tasks = app_state.tasks.lock().await;
    tasks.complete_task(task_id);
    Json(())
}

pub async fn mark_failed(
    State(app_state): State<WorkerAdapter>,
    Path(task_id): Path<Uuid>,
) -> Json<()> {
    let mut tasks = app_state.tasks.lock().await;
    tasks.fail_task(task_id);
    Json(())
}

pub async fn keepalive(
    State(app_state): State<WorkerAdapter>,
    Path(task_id): Path<Uuid>,
    Json(payload): Json<TaskAttempt>,
) -> Json<()> {
    let mut tasks = app_state.tasks.lock().await;
    tasks.update_task_attempt(task_id, payload);
    Json(())
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
                    let mut state = app_state.listeners.lock().await;
                    state.notify_document_listeners(document_id, &change).await;
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
