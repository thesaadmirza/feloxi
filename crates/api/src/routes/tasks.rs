use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::routes::responses::{
    CommandResponse, RetryAttempt, RetryChainResponse, TaskListResponse, TaskSummaryListResponse,
    TaskTimelineResponse,
};
use crate::state::AppState;
use auth::middleware::CurrentUser;
use common::AppError;
use db::clickhouse::task_events::{TaskEventRow, TaskFilters};

#[derive(Deserialize, IntoParams, ToSchema)]
pub struct TaskListParams {
    pub state: Option<String>,
    pub task_name: Option<String>,
    pub queue: Option<String>,
    pub worker_id: Option<String>,
    /// Free-text substring search across task_id, task_name, args, kwargs,
    /// result, and exception.
    pub search: Option<String>,
    /// When true, only return tasks with a non-empty exception.
    pub has_error: Option<bool>,
    /// Lower bound on `timestamp` (millis since epoch, inclusive).
    pub since_ms: Option<i64>,
    /// Upper bound on `timestamp` (millis since epoch, inclusive).
    pub until_ms: Option<i64>,
    pub limit: Option<u64>,
    pub cursor: Option<String>,
}

impl TaskListParams {
    fn filters(&self) -> TaskFilters<'_> {
        TaskFilters {
            task_name: self.task_name.as_deref().filter(|s| !s.is_empty()),
            state: self.state.as_deref().filter(|s| !s.is_empty()),
            queue: self.queue.as_deref().filter(|s| !s.is_empty()),
            worker_id: self.worker_id.as_deref().filter(|s| !s.is_empty()),
            search: self.search.as_deref().filter(|s| !s.is_empty()),
            has_error: self.has_error,
            since_ms: self.since_ms,
            until_ms: self.until_ms,
        }
    }
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

    let (limit, cursor_ms) = parse_cursor_params(&params);
    let filters = params.filters();

    let mut events = db::clickhouse::task_events::query_task_events(
        &state.ch,
        user.tenant_id,
        limit + 1,
        &filters,
        cursor_ms,
    )
    .await?;

    let (has_more, next_cursor) = paginate(&mut events, limit, |e| {
        let ms = e.timestamp.unix_timestamp() * 1000 + e.timestamp.millisecond() as i64;
        ms.to_string()
    });

    Ok(Json(TaskListResponse { data: events, has_more, next_cursor, total: None }))
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

    let original_task =
        db::clickhouse::task_events::get_task_latest(&state.ch, user.tenant_id, &task_id).await?;

    let (parent_id, root_id) = match &original_task {
        Some(t) => {
            (Some(task_id.clone()), Some(t.root_id.clone().unwrap_or_else(|| task_id.clone())))
        }
        None => (Some(task_id.clone()), Some(task_id.clone())),
    };

    if let Some(config) = find_active_broker(&state, user.tenant_id).await {
        match crate::broker_conn::commands::publish_task(
            &config.broker_type,
            &config.connection_enc,
            &req.task_name,
            &new_task_id,
            &req.args,
            &req.kwargs,
            &req.queue,
            parent_id.as_deref(),
            root_id.as_deref(),
        )
        .await
        {
            Ok(()) => {
                record_synthetic_retry_event(
                    &state,
                    user.tenant_id,
                    config.id,
                    &config.broker_type,
                    &new_task_id,
                    &req,
                    parent_id.as_deref(),
                    root_id.as_deref(),
                )
                .await;

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

/// After a successful retry publish, emit a synthetic `task-sent` event so
/// the new task_id is immediately queryable by the UI. Without this the
/// frontend navigates to /tasks/{new_id} before any worker has touched the
/// task and the detail page 404s.
async fn record_synthetic_retry_event(
    state: &AppState,
    tenant_id: Uuid,
    broker_config_id: Uuid,
    broker_type: &str,
    new_task_id: &str,
    req: &RetryRequest,
    parent_id: Option<&str>,
    root_id: Option<&str>,
) {
    let raw = common::RawTaskEvent {
        task_id: new_task_id.to_string(),
        task_name: req.task_name.clone(),
        event_type: "task-sent".to_string(),
        timestamp: chrono::Utc::now().timestamp_millis() as f64 / 1000.0,
        queue: Some(req.queue.clone()),
        worker_id: None,
        state: None,
        args: Some(req.args.to_string()),
        kwargs: Some(req.kwargs.to_string()),
        result: None,
        exception: None,
        traceback: None,
        runtime: None,
        retries: None,
        eta: None,
        expires: None,
        root_id: root_id.map(str::to_string),
        parent_id: parent_id.map(str::to_string),
        group_id: None,
        chord_id: None,
    };

    crate::broker_conn::pipeline::ingest_raw_task_events(
        state,
        tenant_id,
        broker_config_id,
        broker_type,
        vec![raw],
    )
    .await;
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

fn parse_cursor_params(params: &TaskListParams) -> (u64, Option<i64>) {
    let limit = params.limit.unwrap_or(50).clamp(1, 200);
    let cursor_ms = params.cursor.as_deref().and_then(|c| c.parse().ok());
    (limit, cursor_ms)
}

fn paginate<T>(
    rows: &mut Vec<T>,
    limit: u64,
    cursor_fn: impl Fn(&T) -> String,
) -> (bool, Option<String>) {
    let has_more = rows.len() > limit as usize;
    if has_more {
        rows.truncate(limit as usize);
    }
    let next_cursor = if has_more { rows.last().map(&cursor_fn) } else { None };
    (has_more, next_cursor)
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

#[utoipa::path(get, path = "/api/v1/tasks/summary", tag = "tasks",
    params(TaskListParams),
    responses((status = 200, description = "Task-centric summary", body = TaskSummaryListResponse))
)]
pub async fn list_task_summary(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Query(params): Query<TaskListParams>,
) -> Result<Json<TaskSummaryListResponse>, AppError> {
    auth::rbac::check_permission(&user, "tasks_read")?;

    let (limit, cursor_ms) = parse_cursor_params(&params);
    let filters = params.filters();

    let mut rows = db::clickhouse::aggregations::get_task_summary(
        &state.ch,
        user.tenant_id,
        limit + 1,
        &filters,
        cursor_ms,
    )
    .await?;

    let (has_more, next_cursor) = paginate(&mut rows, limit, |r| {
        let ms = r.timestamp.unix_timestamp() * 1000 + r.timestamp.millisecond() as i64;
        ms.to_string()
    });

    Ok(Json(TaskSummaryListResponse { data: rows, has_more, next_cursor }))
}

#[utoipa::path(get, path = "/api/v1/tasks/{task_id}/retry-chain", tag = "tasks",
    params(("task_id" = String, Path, description = "Any task ID in the retry chain")),
    responses(
        (status = 200, description = "Retry chain", body = RetryChainResponse),
        (status = 404, description = "Task not found")
    )
)]
pub async fn get_retry_chain(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(task_id): Path<String>,
) -> Result<Json<RetryChainResponse>, AppError> {
    auth::rbac::check_permission(&user, "tasks_read")?;

    let chain =
        db::clickhouse::task_events::get_retry_chain(&state.ch, user.tenant_id, &task_id).await?;

    if chain.is_empty() {
        return Err(AppError::NotFound(format!("Task {task_id} not found")));
    }

    let task_name = chain[0].task_name.clone();
    let origin_task_id = chain[0].task_id.clone();

    let attempts = chain
        .into_iter()
        .map(|t| {
            let ms = t.timestamp.unix_timestamp() * 1000 + t.timestamp.millisecond() as i64;
            RetryAttempt {
                task_id: t.task_id,
                state: t.state,
                timestamp_ms: ms,
                runtime: t.runtime,
                retries: t.retries,
                exception: t.exception,
                worker_id: t.worker_id,
            }
        })
        .collect();

    Ok(Json(RetryChainResponse { task_name, origin_task_id, attempts }))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tasks", get(list_tasks))
        .route("/tasks/summary", get(list_task_summary))
        .route("/tasks/{task_id}", get(get_task))
        .route("/tasks/{task_id}/timeline", get(get_task_timeline))
        .route("/tasks/{task_id}/retry", post(retry_task))
        .route("/tasks/{task_id}/revoke", post(revoke_task))
        .route("/tasks/{task_id}/retry-chain", get(get_retry_chain))
}
