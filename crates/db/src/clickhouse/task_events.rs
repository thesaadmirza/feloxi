use clickhouse::Client;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use common::AppError;

/// ClickHouse row type for task_events table.
#[derive(Debug, Clone, Serialize, Deserialize, clickhouse::Row, ToSchema)]
pub struct TaskEventRow {
    #[serde(with = "clickhouse::serde::uuid")]
    #[schema(value_type = String, format = "uuid")]
    pub tenant_id: Uuid,
    #[serde(with = "clickhouse::serde::uuid")]
    #[schema(value_type = String, format = "uuid")]
    pub event_id: Uuid,
    pub task_id: String,
    pub task_name: String,
    pub queue: String,
    pub worker_id: String,
    pub state: String,
    pub event_type: String,
    #[serde(with = "clickhouse::serde::time::datetime64::millis")]
    #[schema(value_type = i64)]
    pub timestamp: OffsetDateTime,
    pub args: String,
    pub kwargs: String,
    pub result: String,
    pub exception: String,
    pub traceback: String,
    pub runtime: f64,
    pub retries: u32,
    pub root_id: Option<String>,
    pub parent_id: Option<String>,
    pub group_id: Option<String>,
    pub chord_id: Option<String>,
    #[serde(with = "clickhouse::serde::uuid")]
    #[schema(value_type = String, format = "uuid")]
    pub agent_id: Uuid,
    pub broker_type: String,
}

/// Insert a batch of task events.
pub async fn insert_task_events(client: &Client, events: &[TaskEventRow]) -> Result<(), AppError> {
    if events.is_empty() {
        return Ok(());
    }

    let mut insert = client.insert("task_events").map_err(|e| AppError::Database(e.to_string()))?;

    for event in events {
        insert.write(event).await.map_err(|e| AppError::Database(e.to_string()))?;
    }

    insert.end().await.map_err(|e| AppError::Database(e.to_string()))?;

    Ok(())
}

const TASK_EVENT_BASE_WHERE: &str = "\
    WHERE tenant_id = ? \
    AND timestamp >= now() - toIntervalHour(24) \
    AND event_type IN \
    ('task-succeeded', 'task-failed', 'task-started', 'task-received', 'task-sent', 'task-retried', 'task-revoked')";

fn append_task_filters(
    query: &mut String,
    task_name: Option<&str>,
    state: Option<&str>,
    queue: Option<&str>,
) {
    if task_name.is_some() {
        query.push_str(" AND task_name = ?");
    }
    if state.is_some() {
        query.push_str(" AND state = ?");
    }
    if queue.is_some() {
        query.push_str(" AND queue = ?");
    }
}

fn bind_task_filters<'a>(
    mut q: clickhouse::query::Query,
    tenant_id: Uuid,
    task_name: Option<&'a str>,
    state: Option<&'a str>,
    queue: Option<&'a str>,
) -> clickhouse::query::Query {
    q = q.bind(tenant_id);
    if let Some(tn) = task_name {
        q = q.bind(tn);
    }
    if let Some(s) = state {
        q = q.bind(s);
    }
    if let Some(qn) = queue {
        q = q.bind(qn);
    }
    q
}

pub async fn count_task_events(
    client: &Client,
    tenant_id: Uuid,
    task_name: Option<&str>,
    state: Option<&str>,
    queue: Option<&str>,
) -> Result<u64, AppError> {
    let mut query = format!("SELECT count() FROM task_events {TASK_EVENT_BASE_WHERE}");
    append_task_filters(&mut query, task_name, state, queue);

    let q = bind_task_filters(client.query(&query), tenant_id, task_name, state, queue);

    let count: u64 = q.fetch_one().await.map_err(|e| AppError::Database(e.to_string()))?;

    Ok(count)
}

pub async fn query_task_events(
    client: &Client,
    tenant_id: Uuid,
    limit: u64,
    task_name: Option<&str>,
    state: Option<&str>,
    queue: Option<&str>,
    cursor_ms: Option<i64>,
) -> Result<Vec<TaskEventRow>, AppError> {
    let mut query = format!(
        "SELECT tenant_id, event_id, task_id, \
         CAST(task_name AS String) AS task_name, \
         CAST(queue AS String) AS queue, \
         worker_id, \
         CAST(state AS String) AS state, \
         CAST(event_type AS String) AS event_type, \
         timestamp, args, kwargs, result, exception, traceback, runtime, retries, \
         root_id, parent_id, group_id, chord_id, agent_id, \
         CAST(broker_type AS String) AS broker_type \
         FROM task_events {TASK_EVENT_BASE_WHERE}"
    );

    append_task_filters(&mut query, task_name, state, queue);

    if cursor_ms.is_some() {
        query.push_str(" AND timestamp < fromUnixTimestamp64Milli(toInt64(?))");
    }

    query.push_str(" ORDER BY timestamp DESC LIMIT ?");

    let mut q = bind_task_filters(client.query(&query), tenant_id, task_name, state, queue);

    if let Some(ms) = cursor_ms {
        q = q.bind(ms);
    }

    let rows = q
        .bind(limit)
        .fetch_all::<TaskEventRow>()
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows)
}

/// Get a single task's full event history.
pub async fn get_task_timeline(
    client: &Client,
    tenant_id: Uuid,
    task_id: &str,
) -> Result<Vec<TaskEventRow>, AppError> {
    let rows = client
        .query(
            "SELECT tenant_id, event_id, task_id, \
                CAST(task_name AS String) AS task_name, \
                CAST(queue AS String) AS queue, \
                worker_id, \
                CAST(state AS String) AS state, \
                CAST(event_type AS String) AS event_type, \
                timestamp, args, kwargs, result, exception, traceback, runtime, retries, \
                root_id, parent_id, group_id, chord_id, agent_id, \
                CAST(broker_type AS String) AS broker_type \
                FROM task_events WHERE tenant_id = ? AND task_id = ? ORDER BY timestamp ASC",
        )
        .bind(tenant_id)
        .bind(task_id)
        .fetch_all::<TaskEventRow>()
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows)
}

/// Merged SELECT that combines data across all events for a task_id.
/// Uses argMax for latest-wins fields and argMaxIf for first-non-empty fields.
const MERGED_TASK_SELECT: &str = "\
    any(tenant_id) AS tenant_id, \
    argMax(event_id, timestamp) AS event_id, \
    task_id, \
    CAST(argMaxIf(task_name, timestamp, task_name != '') AS String) AS task_name, \
    CAST(argMaxIf(queue, timestamp, queue != '') AS String) AS queue, \
    argMaxIf(worker_id, timestamp, worker_id != '') AS worker_id, \
    CAST(argMax(state, timestamp) AS String) AS state, \
    CAST(argMax(event_type, timestamp) AS String) AS event_type, \
    max(timestamp) AS timestamp, \
    argMaxIf(args, timestamp, args != '') AS args, \
    argMaxIf(kwargs, timestamp, kwargs != '') AS kwargs, \
    argMaxIf(result, timestamp, result != '') AS result, \
    argMaxIf(exception, timestamp, exception != '') AS exception, \
    argMaxIf(traceback, timestamp, traceback != '') AS traceback, \
    argMax(runtime, timestamp) AS runtime, \
    max(retries) AS retries, \
    argMaxIf(root_id, timestamp, root_id IS NOT NULL AND root_id != '') AS root_id, \
    argMaxIf(parent_id, timestamp, parent_id IS NOT NULL AND parent_id != '') AS parent_id, \
    argMaxIf(group_id, timestamp, group_id IS NOT NULL AND group_id != '') AS group_id, \
    argMaxIf(chord_id, timestamp, chord_id IS NOT NULL AND chord_id != '') AS chord_id, \
    any(agent_id) AS agent_id, \
    CAST(argMaxIf(broker_type, timestamp, broker_type != '') AS String) AS broker_type";

/// Get a merged view of a single task, combining fields from all its events.
pub async fn get_task_latest(
    client: &Client,
    tenant_id: Uuid,
    task_id: &str,
) -> Result<Option<TaskEventRow>, AppError> {
    let query = format!(
        "SELECT {MERGED_TASK_SELECT} FROM task_events \
         WHERE tenant_id = ? AND task_id = ? GROUP BY task_id"
    );
    let rows = client
        .query(&query)
        .bind(tenant_id)
        .bind(task_id)
        .fetch_all::<TaskEventRow>()
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows.into_iter().next())
}

/// Get all tasks belonging to a workflow (sharing the same root_id).
/// Merges fields per task_id so args/kwargs from received events are preserved.
pub async fn get_workflow_tasks(
    client: &Client,
    tenant_id: Uuid,
    root_id: &str,
) -> Result<Vec<TaskEventRow>, AppError> {
    let query = format!(
        "SELECT {MERGED_TASK_SELECT} FROM task_events \
         WHERE tenant_id = ? AND (root_id = ? OR task_id = ?) \
         GROUP BY task_id ORDER BY max(timestamp) ASC"
    );
    let rows = client
        .query(&query)
        .bind(tenant_id)
        .bind(root_id)
        .bind(root_id)
        .fetch_all::<TaskEventRow>()
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows)
}
