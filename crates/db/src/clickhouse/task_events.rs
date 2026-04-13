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

pub const DEFAULT_WINDOW_HOURS: i64 = 24;

const TASK_EVENT_TYPES_IN: &str = " AND event_type IN (\
    'task-succeeded', 'task-failed', 'task-started', 'task-received', \
    'task-sent', 'task-retried', 'task-revoked')";
pub const TASK_STATES_IN: &str = " AND state IN (\
    'PENDING', 'RECEIVED', 'STARTED', 'SUCCESS', 'FAILURE', 'RETRY', 'REVOKED', 'REJECTED')";

#[derive(Debug, Clone, Copy, Default)]
pub struct TaskFilters<'a> {
    pub task_name: Option<&'a str>,
    pub state: Option<&'a str>,
    pub queue: Option<&'a str>,
    pub worker_id: Option<&'a str>,
    pub search: Option<&'a str>,
    pub errors_only: Option<bool>,
    pub since_ms: Option<i64>,
    pub until_ms: Option<i64>,
}

/// Append the tenant check, time window, and user-specified filters. `row_scope`
/// should be either [`TASK_EVENT_TYPES_IN`] or [`TASK_STATES_IN`] — the
/// caller picks which column family to constrain against.
pub fn append_task_where(query: &mut String, filters: &TaskFilters, row_scope: &str) {
    query.push_str(" WHERE tenant_id = ?");

    if filters.since_ms.is_some() {
        query.push_str(" AND timestamp >= fromUnixTimestamp64Milli(toInt64(?))");
    } else {
        query
            .push_str(&format!(" AND timestamp >= now() - toIntervalHour({DEFAULT_WINDOW_HOURS})"));
    }
    if filters.until_ms.is_some() {
        query.push_str(" AND timestamp <= fromUnixTimestamp64Milli(toInt64(?))");
    }

    query.push_str(row_scope);

    if filters.task_name.is_some() {
        query.push_str(" AND positionCaseInsensitive(CAST(task_name AS String), ?) > 0");
    }
    if filters.state.is_some() {
        query.push_str(" AND state = ?");
    }
    if filters.queue.is_some() {
        query.push_str(" AND queue = ?");
    }
    if filters.worker_id.is_some() {
        query.push_str(" AND worker_id = ?");
    }
    if filters.errors_only == Some(true) {
        query.push_str(" AND exception != ''");
    }
    if filters.search.is_some() {
        query.push_str(
            " AND positionCaseInsensitive(\
                concat(task_id, ' ', CAST(task_name AS String), ' ', args, ' ', kwargs, ' ', result, ' ', exception),\
                ?) > 0",
        );
    }
}

pub fn bind_task_filters(
    mut q: clickhouse::query::Query,
    tenant_id: Uuid,
    filters: &TaskFilters,
) -> clickhouse::query::Query {
    q = q.bind(tenant_id);
    if let Some(ms) = filters.since_ms {
        q = q.bind(ms);
    }
    if let Some(ms) = filters.until_ms {
        q = q.bind(ms);
    }
    if let Some(tn) = filters.task_name {
        q = q.bind(tn);
    }
    if let Some(s) = filters.state {
        q = q.bind(s);
    }
    if let Some(qn) = filters.queue {
        q = q.bind(qn);
    }
    if let Some(w) = filters.worker_id {
        q = q.bind(w);
    }
    if let Some(s) = filters.search {
        q = q.bind(s);
    }
    q
}

pub async fn count_task_events(
    client: &Client,
    tenant_id: Uuid,
    filters: &TaskFilters<'_>,
) -> Result<u64, AppError> {
    let mut query = String::from("SELECT count() FROM task_events");
    append_task_where(&mut query, filters, TASK_EVENT_TYPES_IN);

    let q = bind_task_filters(client.query(&query), tenant_id, filters);

    let count: u64 = q.fetch_one().await.map_err(|e| AppError::Database(e.to_string()))?;

    Ok(count)
}

pub async fn query_task_events(
    client: &Client,
    tenant_id: Uuid,
    limit: u64,
    filters: &TaskFilters<'_>,
    cursor_ms: Option<i64>,
) -> Result<Vec<TaskEventRow>, AppError> {
    let mut query = String::from(
        "SELECT tenant_id, event_id, task_id, \
         CAST(task_name AS String) AS task_name, \
         CAST(queue AS String) AS queue, \
         worker_id, \
         CAST(state AS String) AS state, \
         CAST(event_type AS String) AS event_type, \
         timestamp, args, kwargs, result, exception, traceback, runtime, retries, \
         root_id, parent_id, group_id, chord_id, agent_id, \
         CAST(broker_type AS String) AS broker_type \
         FROM task_events",
    );
    append_task_where(&mut query, filters, TASK_EVENT_TYPES_IN);

    if cursor_ms.is_some() {
        query.push_str(" AND timestamp < fromUnixTimestamp64Milli(toInt64(?))");
    }

    query.push_str(" ORDER BY timestamp DESC LIMIT ?");

    let mut q = bind_task_filters(client.query(&query), tenant_id, filters);

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
/// Inner SELECT that merges across all events for a task_id.
/// Uses a subquery pattern: callers wrap raw rows in a subquery first,
/// then apply this SELECT + GROUP BY on the result to avoid ClickHouse 24.12
/// alias-resolution issues (aggregates like `max(ts)` clashing with column names).
const MERGED_TASK_SELECT: &str = "\
    any(tid) AS tenant_id, \
    argMax(eid, ts) AS event_id, \
    task_id, \
    CAST(argMaxIf(tn, ts, tn != '') AS String) AS task_name, \
    CAST(argMaxIf(q, ts, q != '') AS String) AS queue, \
    argMaxIf(wid, ts, wid != '') AS worker_id, \
    CAST(argMax(st, ts) AS String) AS state, \
    CAST(argMax(et, ts) AS String) AS event_type, \
    max(ts) AS timestamp, \
    argMaxIf(a, ts, a != '') AS args, \
    argMaxIf(kw, ts, kw != '') AS kwargs, \
    argMaxIf(res, ts, res != '') AS result, \
    argMaxIf(exc, ts, exc != '') AS exception, \
    argMaxIf(tb, ts, tb != '') AS traceback, \
    argMax(rt, ts) AS runtime, \
    max(retr) AS retries, \
    argMaxIf(rid, ts, rid IS NOT NULL AND rid != '') AS root_id, \
    argMaxIf(pid, ts, pid IS NOT NULL AND pid != '') AS parent_id, \
    argMaxIf(gid, ts, gid IS NOT NULL AND gid != '') AS group_id, \
    argMaxIf(cid, ts, cid IS NOT NULL AND cid != '') AS chord_id, \
    any(aid) AS agent_id, \
    CAST(argMaxIf(bt, ts, bt != '') AS String) AS broker_type";

/// Subquery that renames columns to avoid alias collisions in MERGED_TASK_SELECT.
const MERGED_TASK_FROM: &str = "\
    (SELECT tenant_id AS tid, event_id AS eid, task_id, \
    task_name AS tn, queue AS q, worker_id AS wid, state AS st, \
    event_type AS et, timestamp AS ts, args AS a, kwargs AS kw, \
    result AS res, exception AS exc, traceback AS tb, runtime AS rt, \
    retries AS retr, root_id AS rid, parent_id AS pid, group_id AS gid, \
    chord_id AS cid, agent_id AS aid, broker_type AS bt \
    FROM task_events WHERE ";

/// Get a merged view of a single task, combining fields from all its events.
pub async fn get_task_latest(
    client: &Client,
    tenant_id: Uuid,
    task_id: &str,
) -> Result<Option<TaskEventRow>, AppError> {
    let query = format!(
        "SELECT {MERGED_TASK_SELECT} FROM \
         {MERGED_TASK_FROM} tenant_id = ? AND task_id = ?) \
         GROUP BY task_id"
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
        "SELECT {MERGED_TASK_SELECT} FROM \
         {MERGED_TASK_FROM} tenant_id = ? AND (root_id = ? OR task_id = ?)) \
         GROUP BY task_id ORDER BY timestamp ASC"
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

/// Find direct children of the given parent task IDs that share the same task name.
async fn get_children_by_parent_ids(
    client: &Client,
    tenant_id: Uuid,
    parent_ids: &[String],
    task_name: &str,
) -> Result<Vec<TaskEventRow>, AppError> {
    if parent_ids.is_empty() {
        return Ok(vec![]);
    }

    let placeholders: Vec<&str> = parent_ids.iter().map(|_| "?").collect();
    let in_clause = placeholders.join(", ");

    let query = format!(
        "SELECT {MERGED_TASK_SELECT} FROM \
         {MERGED_TASK_FROM} tenant_id = ? \
         AND parent_id IN ({in_clause})) \
         GROUP BY task_id \
         HAVING task_name = ? \
         ORDER BY timestamp ASC"
    );

    let mut q = client.query(&query).bind(tenant_id);
    for pid in parent_ids {
        q = q.bind(pid.as_str());
    }
    q = q.bind(task_name);

    q.fetch_all::<TaskEventRow>().await.map_err(|e| AppError::Database(e.to_string()))
}

/// Get the full retry chain for a task, walking up via `parent_id` and down
/// via child lookups. Only follows links where `task_name` matches (same name
/// = retry; different name = workflow edge).
pub async fn get_retry_chain(
    client: &Client,
    tenant_id: Uuid,
    task_id: &str,
) -> Result<Vec<TaskEventRow>, AppError> {
    const MAX_DEPTH: usize = 50;

    let mut current = match get_task_latest(client, tenant_id, task_id).await? {
        Some(t) => t,
        None => return Ok(vec![]),
    };
    let task_name = current.task_name.clone();

    // Walk UP via parent_id to find the chain root
    let mut ancestors: Vec<TaskEventRow> = Vec::new();
    for _ in 0..MAX_DEPTH {
        let pid = match &current.parent_id {
            Some(pid) if !pid.is_empty() => pid.clone(),
            _ => break,
        };
        match get_task_latest(client, tenant_id, &pid).await? {
            Some(p) if p.task_name == task_name => {
                ancestors.push(current);
                current = p;
            }
            _ => break,
        }
    }
    ancestors.reverse();

    // Build chain: root ancestor (current) + remaining ancestors + walk-down
    let leaf_id = ancestors.last().map_or(current.task_id.clone(), |a| a.task_id.clone());
    let mut chain = vec![current];
    chain.append(&mut ancestors);

    // Walk DOWN level-by-level from the leaf
    let mut level_parents = vec![leaf_id];

    for _ in 0..MAX_DEPTH {
        let children =
            get_children_by_parent_ids(client, tenant_id, &level_parents, &task_name).await?;
        if children.is_empty() {
            break;
        }
        level_parents = children.iter().map(|c| c.task_id.clone()).collect();
        chain.extend(children);
    }

    Ok(chain)
}
