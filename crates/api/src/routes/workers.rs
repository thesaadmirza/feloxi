use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};

use crate::routes::responses::{CommandResponse, WorkerDetailResponse, WorkerListResponse, WorkerState};
use crate::state::AppState;
use auth::middleware::CurrentUser;
use common::AppError;

#[derive(Deserialize, ToSchema, IntoParams)]
#[allow(dead_code)]
pub struct WorkerListParams {
    pub status: Option<String>,
    pub limit: Option<u64>,
}

#[utoipa::path(
    get,
    path = "/api/v1/workers",
    tag = "workers",
    params(WorkerListParams),
    responses(
        (status = 200, description = "Success", body = WorkerListResponse)
    )
)]
pub async fn list_workers(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Query(params): Query<WorkerListParams>,
) -> Result<Json<WorkerListResponse>, AppError> {
    auth::rbac::check_permission(&user, "workers_read")?;

    let online = db::redis::cache::get_online_workers(&state.redis, user.tenant_id)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    let limit = params.limit.unwrap_or(100);
    let events = db::clickhouse::worker_events::query_worker_events(
        &state.ch,
        user.tenant_id,
        None,
        limit,
    )
    .await?;

    let event_worker_ids: std::collections::HashSet<String> = events
        .iter()
        .map(|e| e.worker_id.clone())
        .collect();

    let mut worker_states: Vec<WorkerState> = Vec::new();
    for wid in &online {
        if !event_worker_ids.contains(wid) {
            let state_key = db::redis::keys::worker_state(user.tenant_id, wid);
            if let Ok(Some(cached)) =
                db::redis::cache::get_json::<WorkerState>(&state.redis, &state_key).await
            {
                worker_states.push(cached);
            }
        }
    }

    Ok(Json(WorkerListResponse {
        online_workers: online,
        worker_events: events,
        worker_states,
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/workers/{worker_id}",
    tag = "workers",
    params(("worker_id" = String, Path, description = "Worker ID")),
    responses(
        (status = 200, description = "Success", body = WorkerDetailResponse)
    )
)]
pub async fn get_worker(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(worker_id): Path<String>,
) -> Result<Json<WorkerDetailResponse>, AppError> {
    auth::rbac::check_permission(&user, "workers_read")?;

    let state_key = db::redis::keys::worker_state(user.tenant_id, &worker_id);
    let cached: Option<WorkerState> =
        db::redis::cache::get_json(&state.redis, &state_key)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

    let events = db::clickhouse::worker_events::query_worker_events(
        &state.ch,
        user.tenant_id,
        Some(&worker_id),
        50,
    )
    .await?;

    Ok(Json(WorkerDetailResponse {
        worker_id,
        current_state: cached,
        recent_events: events,
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/workers/{worker_id}/shutdown",
    tag = "workers",
    params(("worker_id" = String, Path, description = "Worker ID")),
    responses(
        (status = 200, description = "Success", body = CommandResponse)
    )
)]
pub async fn shutdown_worker(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(worker_id): Path<String>,
) -> Result<Json<CommandResponse>, AppError> {
    auth::rbac::check_permission(&user, "workers_shutdown")?;

    if let Ok(configs) =
        db::postgres::broker_configs::list_broker_configs(&state.pg, user.tenant_id).await
    {
        for config in &configs {
            if config.is_active && config.status == "connected" {
                match crate::broker_conn::commands::shutdown_worker(
                    &config.broker_type,
                    &config.connection_enc,
                    &worker_id,
                )
                .await
                {
                    Ok(()) => {
                        return Ok(Json(CommandResponse {
                            task_id: None,
                            command_id: None,
                            status: "shutdown".into(),
                            message: Some("Shutdown command broadcast to worker via broker".into()),
                        }));
                    }
                    Err(e) => {
                        tracing::warn!(%worker_id, "Broker-direct shutdown failed: {e}");
                    }
                }
            }
        }
    }

    Err(AppError::BadRequest(
        "No active broker available".into(),
    ))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/workers", get(list_workers))
        .route("/workers/{worker_id}", get(get_worker))
        .route("/workers/{worker_id}/shutdown", post(shutdown_worker))
}
