use axum::{extract::State, routing::get, Extension, Json, Router};
use serde::Serialize;
use utoipa::ToSchema;

use crate::routes::responses::WorkerState;
use crate::state::AppState;
use auth::middleware::CurrentUser;
use common::AppError;

async fn get_dashboard_config(
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Return the user's dashboard configuration
    Ok(Json(serde_json::json!({
        "tenant_id": user.tenant_id,
        "user_id": user.user_id,
        "widgets": [
            {"type": "overview_stats", "position": {"x": 0, "y": 0, "w": 12, "h": 2}},
            {"type": "task_throughput", "position": {"x": 0, "y": 2, "w": 6, "h": 3}},
            {"type": "failure_rate", "position": {"x": 6, "y": 2, "w": 6, "h": 3}},
            {"type": "worker_status", "position": {"x": 0, "y": 5, "w": 4, "h": 3}},
            {"type": "queue_depth", "position": {"x": 4, "y": 5, "w": 4, "h": 3}},
            {"type": "recent_failures", "position": {"x": 8, "y": 5, "w": 4, "h": 3}},
        ]
    })))
}

#[derive(Serialize, ToSchema)]
pub struct DashboardLiveResponse {
    /// Sum of `active_tasks` across every online worker — the number of tasks
    /// currently executing right now, not over a window.
    pub active_tasks_total: u64,
    /// Sum of broker-reported queue depths for every active queue.
    pub queue_depth_total: u64,
    /// Number of online workers (heartbeat within the last ~90s).
    pub online_workers_total: u64,
    /// Sum of pool sizes across online workers — the maximum concurrent
    /// capacity the cluster could process. Useful for showing utilisation.
    pub worker_capacity_total: u64,
    /// Per-worker live snapshot, sorted by `active_tasks` descending. Bounded
    /// by the dashboard widget's display limit.
    pub workers: Vec<DashboardLiveWorker>,
    /// Per-queue live snapshot, sorted by `depth` descending.
    pub queues: Vec<DashboardLiveQueue>,
}

#[derive(Serialize, ToSchema)]
pub struct DashboardLiveWorker {
    pub worker_id: String,
    pub hostname: String,
    pub active_tasks: u32,
    pub pool_size: u32,
}

#[derive(Serialize, ToSchema)]
pub struct DashboardLiveQueue {
    pub queue_name: String,
    pub depth: u64,
}

const LIVE_WORKER_DISPLAY_LIMIT: usize = 50;
const LIVE_QUEUE_DISPLAY_LIMIT: usize = 50;

#[utoipa::path(
    get,
    path = "/api/v1/dashboard/live",
    tag = "dashboards",
    responses((status = 200, description = "Live cluster snapshot", body = DashboardLiveResponse))
)]
pub async fn get_dashboard_live(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<DashboardLiveResponse>, AppError> {
    auth::rbac::check_permission(&user, "tasks_read")?;

    let worker_ids = db::redis::cache::get_online_workers(&state.redis, user.tenant_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read online workers: {e}")))?;

    let raw_states =
        db::redis::cache::get_worker_states_raw(&state.redis, user.tenant_id, &worker_ids)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to read worker states: {e}")))?;

    let mut workers: Vec<DashboardLiveWorker> = raw_states
        .into_iter()
        .filter_map(|raw| raw.and_then(|json| serde_json::from_str::<WorkerState>(&json).ok()))
        .map(|s| DashboardLiveWorker {
            worker_id: s.worker_id,
            hostname: s.hostname,
            active_tasks: s.active_tasks,
            pool_size: s.pool_size,
        })
        .collect();
    workers.sort_by(|a, b| b.active_tasks.cmp(&a.active_tasks));

    let active_tasks_total: u64 = workers.iter().map(|w| w.active_tasks as u64).sum();
    let worker_capacity_total: u64 = workers.iter().map(|w| w.pool_size as u64).sum();
    let online_workers_total = workers.len() as u64;
    workers.truncate(LIVE_WORKER_DISPLAY_LIMIT);

    let depth_pairs = db::redis::cache::get_queue_depths(&state.redis, user.tenant_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read queue depths: {e}")))?;
    let queue_depth_total: u64 = depth_pairs.iter().map(|(_, d)| *d).sum();
    let mut queues: Vec<DashboardLiveQueue> = depth_pairs
        .into_iter()
        .map(|(queue_name, depth)| DashboardLiveQueue { queue_name, depth })
        .collect();
    queues.sort_by(|a, b| b.depth.cmp(&a.depth));
    queues.truncate(LIVE_QUEUE_DISPLAY_LIMIT);

    Ok(Json(DashboardLiveResponse {
        active_tasks_total,
        queue_depth_total,
        online_workers_total,
        worker_capacity_total,
        workers,
        queues,
    }))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/dashboards", get(get_dashboard_config))
        .route("/dashboard/live", get(get_dashboard_live))
}
