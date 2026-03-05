use axum::{
    extract::{Query, State},
    routing::get,
    Extension, Json, Router,
};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};

use crate::routes::responses::{
    OverviewResponse, QueueMetricsResponse, StringListResponse, ThroughputResponse,
};
use crate::state::AppState;
use auth::middleware::CurrentUser;
use common::AppError;

#[derive(Deserialize, ToSchema, IntoParams)]
pub struct MetricsParams {
    pub from_minutes: Option<u64>,
    pub queue: Option<String>,
    /// Filter by broker/agent ID (for per-broker throughput charts).
    pub agent_id: Option<uuid::Uuid>,
}

#[utoipa::path(
    get,
    path = "/api/v1/metrics/overview",
    tag = "metrics",
    params(MetricsParams),
    responses((status = 200, description = "Success", body = OverviewResponse))
)]
pub async fn overview(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Query(params): Query<MetricsParams>,
) -> Result<Json<OverviewResponse>, AppError> {
    auth::rbac::check_permission(&user, "metrics_read")?;
    let from = params.from_minutes.unwrap_or(60);

    let stats =
        db::clickhouse::aggregations::get_overview_stats(&state.ch, user.tenant_id, from).await?;

    let online_workers = db::redis::cache::get_online_workers(&state.redis, user.tenant_id)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(Json(OverviewResponse {
        total_tasks: stats.total_tasks,
        success_count: stats.success_count,
        failure_count: stats.failure_count,
        failure_rate: if stats.total_tasks > 0 {
            stats.failure_count as f64 / stats.total_tasks as f64
        } else {
            0.0
        },
        avg_runtime: stats.avg_runtime,
        p95_runtime: stats.p95_runtime,
        avg_wait_time: stats.avg_wait_time.unwrap_or(0.0),
        active_workers: online_workers.len(),
        period_minutes: from,
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/metrics/throughput",
    tag = "metrics",
    params(MetricsParams),
    responses((status = 200, description = "Success", body = ThroughputResponse))
)]
pub async fn throughput(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Query(params): Query<MetricsParams>,
) -> Result<Json<ThroughputResponse>, AppError> {
    auth::rbac::check_permission(&user, "metrics_read")?;
    let from = params.from_minutes.unwrap_or(60);

    let metrics = db::clickhouse::aggregations::get_throughput_metrics(
        &state.ch,
        user.tenant_id,
        from,
        params.agent_id,
    )
    .await?;

    Ok(Json(ThroughputResponse { data: metrics }))
}

#[utoipa::path(
    get,
    path = "/api/v1/metrics/queues",
    tag = "metrics",
    params(MetricsParams),
    responses((status = 200, description = "Success", body = QueueMetricsResponse))
)]
pub async fn queue_metrics(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Query(params): Query<MetricsParams>,
) -> Result<Json<QueueMetricsResponse>, AppError> {
    auth::rbac::check_permission(&user, "metrics_read")?;
    let queue = params.queue.as_deref().unwrap_or("default");
    let from = params.from_minutes.unwrap_or(60);

    let metrics =
        db::clickhouse::aggregations::get_queue_metrics(&state.ch, user.tenant_id, queue, from)
            .await?;

    Ok(Json(QueueMetricsResponse { data: metrics }))
}

#[utoipa::path(
    get,
    path = "/api/v1/metrics/task-names",
    tag = "metrics",
    responses((status = 200, description = "Success", body = StringListResponse))
)]
pub async fn task_names(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<StringListResponse>, AppError> {
    auth::rbac::check_permission(&user, "metrics_read")?;
    let names = db::clickhouse::aggregations::get_task_names(&state.ch, user.tenant_id).await?;
    Ok(Json(StringListResponse { data: names }))
}

#[utoipa::path(
    get,
    path = "/api/v1/metrics/queue-names",
    tag = "metrics",
    responses((status = 200, description = "Success", body = StringListResponse))
)]
pub async fn queue_names(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<StringListResponse>, AppError> {
    auth::rbac::check_permission(&user, "metrics_read")?;
    let names = db::clickhouse::aggregations::get_queue_names(&state.ch, user.tenant_id).await?;
    Ok(Json(StringListResponse { data: names }))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/metrics/overview", get(overview))
        .route("/metrics/throughput", get(throughput))
        .route("/metrics/queues", get(queue_metrics))
        .route("/metrics/task-names", get(task_names))
        .route("/metrics/queue-names", get(queue_names))
}
