use clickhouse::Client;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use common::AppError;

#[derive(Debug, Clone, Serialize, Deserialize, clickhouse::Row, ToSchema)]
pub struct WorkerEventRow {
    #[serde(with = "clickhouse::serde::uuid")]
    #[schema(value_type = String, format = "uuid")]
    pub tenant_id: Uuid,
    #[serde(with = "clickhouse::serde::uuid")]
    #[schema(value_type = String, format = "uuid")]
    pub event_id: Uuid,
    pub worker_id: String,
    pub hostname: String,
    pub event_type: String,
    #[serde(with = "clickhouse::serde::time::datetime64::millis")]
    #[schema(value_type = i64)]
    pub timestamp: OffsetDateTime,
    pub active_tasks: u32,
    pub processed: u64,
    pub load_avg: Vec<f64>,
    pub cpu_percent: f64,
    pub memory_mb: f64,
    pub pool_size: u32,
    pub pool_type: String,
    pub sw_ident: String,
    pub sw_ver: String,
    #[serde(with = "clickhouse::serde::uuid")]
    #[schema(value_type = String, format = "uuid")]
    pub agent_id: Uuid,
}

pub async fn insert_worker_events(
    client: &Client,
    events: &[WorkerEventRow],
) -> Result<(), AppError> {
    if events.is_empty() {
        return Ok(());
    }

    let mut insert = client
        .insert("worker_events")
        .map_err(|e| AppError::Database(e.to_string()))?;

    for event in events {
        insert
            .write(event)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;
    }

    insert
        .end()
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(())
}

pub async fn query_worker_events(
    client: &Client,
    tenant_id: Uuid,
    worker_id: Option<&str>,
    limit: u64,
) -> Result<Vec<WorkerEventRow>, AppError> {
    let cols = "tenant_id, event_id, worker_id, \
                CAST(hostname AS String) AS hostname, \
                CAST(event_type AS String) AS event_type, \
                timestamp, active_tasks, processed, load_avg, \
                cpu_percent, memory_mb, pool_size, \
                CAST(pool_type AS String) AS pool_type, \
                CAST(sw_ident AS String) AS sw_ident, \
                CAST(sw_ver AS String) AS sw_ver, \
                agent_id";
    let query = if worker_id.is_some() {
        format!("SELECT {cols} FROM worker_events WHERE tenant_id = ? AND worker_id = ? ORDER BY timestamp DESC LIMIT ?")
    } else {
        format!("SELECT {cols} FROM worker_events WHERE tenant_id = ? ORDER BY timestamp DESC LIMIT ?")
    };

    let mut q = client.query(&query).bind(tenant_id);

    if let Some(wid) = worker_id {
        q = q.bind(wid);
    }

    let rows = q
        .bind(limit)
        .fetch_all::<WorkerEventRow>()
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows)
}
