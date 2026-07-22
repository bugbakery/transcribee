use crate::state::{BACKEND_STATE, BackendState, Task, TaskType};
use axum::{Json, body::Bytes};
use axum_extra::extract::Query;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct GetUnassingedTaskQuery {
    #[serde(rename = "task_type")]
    task_types: Vec<TaskType>,
}

pub async fn claim_unassigned_task(
    Query(query): Query<GetUnassingedTaskQuery>,
) -> Json<Option<Task>> {
    let mut state = BACKEND_STATE.lock().unwrap();
    return Json(state.claim_unassigned_task(&query.task_types));
}

pub async fn noop(body: Bytes) -> Json<()> {
    log::debug!("noop req: {:?}", body);
    Json(())
}
pub async fn dump_state() -> Json<BackendState> {
    return Json(BACKEND_STATE.lock().unwrap().clone());
}
