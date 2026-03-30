use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};

use crate::routes::responses::{
    CommandResponse, WorkerDetailResponse, WorkerHealthResponse, WorkerHealthRow,
    WorkerListResponse, WorkerState, WorkerTaskStatsResponse,
};
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
    let events =
        db::clickhouse::worker_events::query_worker_events(&state.ch, user.tenant_id, None, limit)
            .await?;

    let event_worker_ids: std::collections::HashSet<String> =
        events.iter().map(|e| e.worker_id.clone()).collect();

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

    Ok(Json(WorkerListResponse { online_workers: online, worker_events: events, worker_states }))
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
    let cached: Option<WorkerState> = db::redis::cache::get_json(&state.redis, &state_key)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    let events = db::clickhouse::worker_events::query_worker_events(
        &state.ch,
        user.tenant_id,
        Some(&worker_id),
        50,
    )
    .await?;

    Ok(Json(WorkerDetailResponse { worker_id, current_state: cached, recent_events: events }))
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

    Err(AppError::BadRequest("No active broker available".into()))
}

#[utoipa::path(
    get,
    path = "/api/v1/workers/stats",
    tag = "workers",
    responses(
        (status = 200, description = "Per-worker task stats (24h)", body = WorkerTaskStatsResponse)
    )
)]
pub async fn worker_task_stats(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<WorkerTaskStatsResponse>, AppError> {
    auth::rbac::check_permission(&user, "workers_read")?;

    let data =
        db::clickhouse::aggregations::get_worker_task_stats(&state.ch, user.tenant_id).await?;

    Ok(Json(WorkerTaskStatsResponse { data }))
}

#[derive(Deserialize, ToSchema, IntoParams)]
pub struct WorkerHealthParams {
    /// Lookback period in hours (default: 1)
    pub hours: Option<u64>,
}

#[utoipa::path(
    get,
    path = "/api/v1/workers/health",
    tag = "workers",
    params(WorkerHealthParams),
    responses(
        (status = 200, description = "Per-worker heartbeat health", body = WorkerHealthResponse)
    )
)]
pub async fn worker_health(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Query(params): Query<WorkerHealthParams>,
) -> Result<Json<WorkerHealthResponse>, AppError> {
    auth::rbac::check_permission(&user, "workers_read")?;

    let hours = params.hours.unwrap_or(1).clamp(1, 24);

    let online = db::redis::cache::get_online_workers(&state.redis, user.tenant_id)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    let ttls = db::redis::cache::get_heartbeat_ttls(&state.redis, user.tenant_id, &online)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    let ch_health =
        db::clickhouse::aggregations::get_worker_heartbeat_health(&state.ch, user.tenant_id, hours)
            .await?;

    let ch_map: std::collections::HashMap<String, _> =
        ch_health.into_iter().map(|r| (r.worker_id.clone(), r)).collect();

    let data: Vec<WorkerHealthRow> = ttls
        .into_iter()
        .map(|(worker_id, ttl)| {
            let ch = ch_map.get(&worker_id);
            let max_gap = ch.map(|c| c.max_gap_secs).unwrap_or(0.0);
            let status = if ttl <= 0 {
                "offline".to_string()
            } else if ttl < DEGRADED_TTL_THRESHOLD || max_gap > DEGRADED_GAP_THRESHOLD {
                "degraded".to_string()
            } else {
                "healthy".to_string()
            };
            WorkerHealthRow {
                worker_id,
                heartbeat_ttl: ttl,
                last_heartbeat: ch.map(|c| {
                    (c.last_heartbeat.unix_timestamp() * 1000)
                        + c.last_heartbeat.millisecond() as i64
                }),
                heartbeat_count: ch.map(|c| c.heartbeat_count).unwrap_or(0),
                max_gap_secs: max_gap,
                avg_gap_secs: ch.map(|c| c.avg_gap_secs).unwrap_or(0.0),
                load_avg: ch.map(|c| c.load_avg).unwrap_or(0.0),
                active_tasks: ch.map(|c| c.active_tasks).unwrap_or(0),
                status,
            }
        })
        .collect();

    Ok(Json(WorkerHealthResponse { data }))
}

/// Heartbeat TTL below this (seconds) signals degraded health.
const DEGRADED_TTL_THRESHOLD: i64 = 30;
/// Max inter-heartbeat gap (seconds) above which a worker is degraded.
const DEGRADED_GAP_THRESHOLD: f64 = 90.0;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/workers", get(list_workers))
        .route("/workers/stats", get(worker_task_stats))
        .route("/workers/health", get(worker_health))
        .route("/workers/{worker_id}", get(get_worker))
        .route("/workers/{worker_id}/shutdown", post(shutdown_worker))
}
