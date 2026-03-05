use serde::{Deserialize, Serialize};

/// Retention policy configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetentionConfig {
    pub task_events_days: u32,
    pub worker_events_days: u32,
    pub alert_history_days: u32,
}

impl Default for RetentionConfig {
    fn default() -> Self {
        Self { task_events_days: 30, worker_events_days: 14, alert_history_days: 90 }
    }
}

/// Generate ClickHouse ALTER TABLE TTL statement for a tenant's retention policy.
pub fn generate_ttl_sql(table: &str, retention_days: u32) -> String {
    format!("ALTER TABLE {table} MODIFY TTL toDateTime(timestamp) + INTERVAL {retention_days} DAY")
}
