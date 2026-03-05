use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::routes::responses::{CommandResponse, TaskListResponse, TaskTimelineResponse};
use crate::state::AppState;
use auth::middleware::CurrentUser;
use common::AppError;
use db::clickhouse::task_events::TaskEventRow;

#[derive(Deserialize, IntoParams, ToSchema)]
pub struct TaskListParams {
    pub state: Option<String>,
    pub task_name: Option<String>,
    pub queue: Option<String>,
    pub limit: Option<u64>,
    pub cursor: Option<String>,
}

#[utoipa::path(get, path = "/api/v1/tasks", tag = "tasks",
    params(TaskListParams),
    responses((status = 200, description = "Success", body = TaskListResponse))
)]
pub async fn list_tasks(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Query(params): Query<TaskListParams>,
) -> Result<Json<TaskListResponse>, AppError> {
    auth::rbac::check_permission(&user, "tasks_read")?;

    let limit = params.limit.unwrap_or(50).clamp(1, 200);
    let cursor_ms: Option<i64> = params.cursor.as_deref().and_then(|c| c.parse().ok());

    let total = db::clickhouse::task_events::count_task_events(
        &state.ch,
        user.tenant_id,
        params.task_name.as_deref(),
        params.state.as_deref(),
        params.queue.as_deref(),
    )
    .await?;

    let mut events = db::clickhouse::task_events::query_task_events(
        &state.ch,
        user.tenant_id,
        limit + 1,
        params.task_name.as_deref(),
        params.state.as_deref(),
        params.queue.as_deref(),
        cursor_ms,
    )
    .await?;

    let has_more = events.len() > limit as usize;
    if has_more {
        events.truncate(limit as usize);
    }

    let next_cursor = if has_more {
        events.last().map(|e| {
            let ms = e.timestamp.unix_timestamp() * 1000 + e.timestamp.millisecond() as i64;
            ms.to_string()
        })
    } else {
        None
    };

    Ok(Json(TaskListResponse { data: events, has_more, next_cursor, total: Some(total as i64) }))
}

#[utoipa::path(get, path = "/api/v1/tasks/{task_id}", tag = "tasks",
    params(("task_id" = String, Path, description = "Task ID")),
    responses((status = 200, description = "Success", body = TaskEventRow), (status = 404, description = "Not found"))
)]
pub async fn get_task(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(task_id): Path<String>,
) -> Result<Json<TaskEventRow>, AppError> {
    auth::rbac::check_permission(&user, "tasks_read")?;

    let latest =
        db::clickhouse::task_events::get_task_latest(&state.ch, user.tenant_id, &task_id).await?;

    match latest {
        Some(event) => Ok(Json(event)),
        None => Err(AppError::NotFound(format!("Task {task_id} not found"))),
    }
}

#[utoipa::path(get, path = "/api/v1/tasks/{task_id}/timeline", tag = "tasks",
    params(("task_id" = String, Path, description = "Task ID")),
    responses((status = 200, description = "Success", body = TaskTimelineResponse), (status = 404, description = "Not found"))
)]
pub async fn get_task_timeline(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(task_id): Path<String>,
) -> Result<Json<TaskTimelineResponse>, AppError> {
    auth::rbac::check_permission(&user, "tasks_read")?;

    let timeline =
        db::clickhouse::task_events::get_task_timeline(&state.ch, user.tenant_id, &task_id).await?;

    Ok(Json(TaskTimelineResponse { timeline }))
}

#[derive(Deserialize, ToSchema)]
pub struct RetryRequest {
    pub task_name: String,
    pub args: serde_json::Value,
    pub kwargs: serde_json::Value,
    pub queue: String,
}

#[utoipa::path(post, path = "/api/v1/tasks/{task_id}/retry", tag = "tasks",
    params(("task_id" = String, Path, description = "Task ID")),
    request_body = RetryRequest,
    responses((status = 200, description = "Success", body = CommandResponse))
)]
pub async fn retry_task(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(task_id): Path<String>,
    Json(req): Json<RetryRequest>,
) -> Result<Json<CommandResponse>, AppError> {
    auth::rbac::check_permission(&user, "tasks_retry")?;

    let new_task_id = Uuid::new_v4().to_string();

    if let Some(config) = find_active_broker(&state, user.tenant_id).await {
        match crate::broker_conn::commands::publish_task(
            &config.broker_type,
            &config.connection_enc,
            &req.task_name,
            &new_task_id,
            &req.args,
            &req.kwargs,
            &req.queue,
        )
        .await
        {
            Ok(()) => {
                return Ok(Json(CommandResponse {
                    task_id: Some(new_task_id),
                    command_id: None,
                    status: "published".into(),
                    message: Some("Task published directly to broker".into()),
                }));
            }
            Err(e) => {
                tracing::warn!(%task_id, "Broker-direct retry failed: {e}");
            }
        }
    }

    Err(AppError::BadRequest("No active broker available".into()))
}

#[utoipa::path(post, path = "/api/v1/tasks/{task_id}/revoke", tag = "tasks",
    params(("task_id" = String, Path, description = "Task ID")),
    responses((status = 200, description = "Success", body = CommandResponse))
)]
pub async fn revoke_task(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(task_id): Path<String>,
) -> Result<Json<CommandResponse>, AppError> {
    auth::rbac::check_permission(&user, "tasks_revoke")?;

    if let Some(config) = find_active_broker(&state, user.tenant_id).await {
        match crate::broker_conn::commands::revoke_task(
            &config.broker_type,
            &config.connection_enc,
            &task_id,
            false,
        )
        .await
        {
            Ok(()) => {
                return Ok(Json(CommandResponse {
                    task_id: None,
                    command_id: None,
                    status: "revoked".into(),
                    message: Some("Revoke command broadcast to workers via broker".into()),
                }));
            }
            Err(e) => {
                tracing::warn!(%task_id, "Broker-direct revoke failed: {e}");
            }
        }
    }

    Err(AppError::BadRequest("No active broker available".into()))
}

/// Find an active broker config for a tenant.
async fn find_active_broker(
    state: &AppState,
    tenant_id: Uuid,
) -> Option<db::postgres::models::BrokerConfig> {
    db::postgres::broker_configs::list_broker_configs(&state.pg, tenant_id)
        .await
        .ok()?
        .into_iter()
        .find(|c| c.is_active && c.status == "connected")
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tasks", get(list_tasks))
        .route("/tasks/{task_id}", get(get_task))
        .route("/tasks/{task_id}/timeline", get(get_task_timeline))
        .route("/tasks/{task_id}/retry", post(retry_task))
        .route("/tasks/{task_id}/revoke", post(revoke_task))
}
