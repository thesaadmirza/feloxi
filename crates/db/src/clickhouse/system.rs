use clickhouse::Client;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use common::AppError;

// ─────────────────────────── Storage Info ───────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, clickhouse::Row)]
pub struct DiskUsageRow {
    pub total_space: u64,
    pub free_space: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, clickhouse::Row, ToSchema)]
pub struct TableStorageRow {
    pub table: String,
    pub rows: u64,
    pub bytes_on_disk: u64,
}

/// Query ClickHouse disk usage (works with auto-scaling disks).
pub async fn get_disk_usage(client: &Client) -> Result<Option<DiskUsageRow>, AppError> {
    let rows: Vec<DiskUsageRow> = client
        .query("SELECT total_space, free_space FROM system.disks WHERE name = 'default'")
        .fetch_all()
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(rows.into_iter().next())
}

/// Query per-table storage in the feloxi database.
pub async fn get_table_storage(client: &Client) -> Result<Vec<TableStorageRow>, AppError> {
    client
        .query(
            "SELECT table, sum(rows) AS rows, sum(bytes_on_disk) AS bytes_on_disk \
             FROM system.parts \
             WHERE database = 'feloxi' AND active = 1 \
             GROUP BY table \
             ORDER BY bytes_on_disk DESC",
        )
        .fetch_all()
        .await
        .map_err(|e| AppError::Database(e.to_string()))
}

// ─────────────────────────── Health Check ───────────────────────────

/// Simple connectivity check — returns Ok(()) if ClickHouse responds.
pub async fn ping(client: &Client) -> Result<(), AppError> {
    client.query("SELECT 1").execute().await.map_err(|e| AppError::Database(e.to_string()))
}

// ─────────────────────────── Dead-Letter Queue ───────────────────────────

#[derive(Debug, Clone, Serialize, clickhouse::Row)]
pub struct DeadLetterEntry {
    #[serde(with = "clickhouse::serde::uuid")]
    pub tenant_id: Uuid,
    pub event_type: String,
    pub error_code: String,
    pub error_message: String,
    pub retryable: bool,
    pub event_count: u32,
    pub sample_payload: String,
    #[serde(with = "clickhouse::serde::uuid")]
    pub agent_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, clickhouse::Row, ToSchema)]
pub struct DeadLetterRow {
    #[serde(with = "clickhouse::serde::uuid")]
    #[schema(value_type = String, format = "uuid")]
    pub id: Uuid,
    #[serde(with = "clickhouse::serde::uuid")]
    #[schema(value_type = String, format = "uuid")]
    pub tenant_id: Uuid,
    pub event_type: String,
    pub error_code: String,
    pub error_message: String,
    pub retryable: bool,
    pub event_count: u32,
    pub sample_payload: String,
    #[serde(with = "clickhouse::serde::time::datetime64::millis")]
    #[schema(value_type = i64)]
    pub failed_at: OffsetDateTime,
    #[serde(with = "clickhouse::serde::uuid")]
    #[schema(value_type = String, format = "uuid")]
    pub agent_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct DeadLetterSummary {
    pub total: u64,
    pub last_24h: u64,
}

/// Insert a dead-letter entry (best-effort — caller should not propagate errors).
pub async fn insert_dead_letter(client: &Client, entry: &DeadLetterEntry) -> Result<(), AppError> {
    let mut insert =
        client.insert("events_dead_letter").map_err(|e| AppError::Database(e.to_string()))?;
    insert.write(entry).await.map_err(|e| AppError::Database(e.to_string()))?;
    insert.end().await.map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

/// Get recent dead-letter entries for a tenant.
pub async fn get_dead_letters(
    client: &Client,
    tenant_id: Uuid,
    limit: u64,
) -> Result<Vec<DeadLetterRow>, AppError> {
    client
        .query(
            "SELECT id, tenant_id, event_type, error_code, error_message, \
             retryable, event_count, sample_payload, failed_at, agent_id \
             FROM feloxi.events_dead_letter \
             WHERE tenant_id = ? \
             ORDER BY failed_at DESC \
             LIMIT ?",
        )
        .bind(tenant_id)
        .bind(limit)
        .fetch_all()
        .await
        .map_err(|e| AppError::Database(e.to_string()))
}

/// Get dead-letter summary counts for a tenant.
pub async fn get_dead_letter_summary(
    client: &Client,
    tenant_id: Uuid,
) -> Result<DeadLetterSummary, AppError> {
    #[derive(clickhouse::Row, Deserialize)]
    struct CountRow {
        total: u64,
        last_24h: u64,
    }

    let rows: Vec<CountRow> = client
        .query(
            "SELECT count() AS total, \
             countIf(failed_at >= now() - INTERVAL 1 DAY) AS last_24h \
             FROM feloxi.events_dead_letter \
             WHERE tenant_id = ?",
        )
        .bind(tenant_id)
        .fetch_all()
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    let row = rows.into_iter().next();
    Ok(DeadLetterSummary {
        total: row.as_ref().map_or(0, |r| r.total),
        last_24h: row.map_or(0, |r| r.last_24h),
    })
}
