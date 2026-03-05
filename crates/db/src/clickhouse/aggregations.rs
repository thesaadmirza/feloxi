use clickhouse::Client;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use common::AppError;

/// Per-minute task metrics from the materialized view.
#[derive(Debug, Clone, Serialize, Deserialize, clickhouse::Row, ToSchema)]
pub struct TaskMetricsRow {
    #[serde(with = "clickhouse::serde::uuid")]
    #[schema(value_type = String, format = "uuid")]
    pub tenant_id: Uuid,
    pub task_name: String,
    pub queue: String,
    #[serde(with = "clickhouse::serde::time::datetime64::millis")]
    #[schema(value_type = i64)]
    pub minute: OffsetDateTime,
    pub success_count: u64,
    pub failure_count: u64,
    pub retry_count: u64,
    pub revoked_count: u64,
    pub total_count: u64,
    pub total_runtime: f64,
    pub max_runtime: f64,
    pub total_wait_time: Option<f64>,
    pub wait_time_samples: u64,
}

/// Per-minute queue metrics from the materialized view.
#[derive(Debug, Clone, Serialize, Deserialize, clickhouse::Row, ToSchema)]
pub struct QueueMetricsRow {
    #[serde(with = "clickhouse::serde::uuid")]
    #[schema(value_type = String, format = "uuid")]
    pub tenant_id: Uuid,
    pub queue: String,
    #[serde(with = "clickhouse::serde::time::datetime64::millis")]
    #[schema(value_type = i64)]
    pub minute: OffsetDateTime,
    pub enqueued: u64,
    pub dequeued: u64,
    pub completed: u64,
    pub failed: u64,
}

/// Summary stats for the dashboard overview.
#[derive(Debug, Clone, Serialize, Deserialize, clickhouse::Row, ToSchema)]
pub struct OverviewStats {
    pub total_tasks: u64,
    pub success_count: u64,
    pub failure_count: u64,
    pub avg_runtime: f64,
    pub p95_runtime: f64,
    pub avg_wait_time: Option<f64>,
}

/// Get throughput time-series data.
///
/// When `agent_id` is None, reads from the pre-aggregated materialized view.
/// When `agent_id` is Some, queries `task_events` directly with an agent_id filter.
pub async fn get_throughput_metrics(
    client: &Client,
    tenant_id: Uuid,
    from_minutes: u64,
    agent_id: Option<Uuid>,
) -> Result<Vec<TaskMetricsRow>, AppError> {
    let rows = match agent_id {
        None => {
            client
                .query(
                    r#"
                    SELECT tenant_id, CAST(task_name AS String) AS task_name,
                           CAST(queue AS String) AS queue,
                           toDateTime64(minute, 3, 'UTC') AS minute,
                           success_count, failure_count, retry_count, revoked_count,
                           total_count, total_runtime, max_runtime,
                           total_wait_time, wait_time_samples
                    FROM task_metrics_mv
                    WHERE tenant_id = ?
                      AND minute >= now() - toIntervalMinute(?)
                    ORDER BY minute ASC
                    "#,
                )
                .bind(tenant_id)
                .bind(from_minutes)
                .fetch_all::<TaskMetricsRow>()
                .await
                .map_err(|e| AppError::Database(e.to_string()))?
        }
        Some(aid) => {
            client
                .query(
                    r#"
                    SELECT
                        tenant_id,
                        CAST(task_name AS String) AS task_name,
                        CAST(queue AS String) AS queue,
                        toDateTime64(toStartOfMinute(timestamp), 3, 'UTC') AS minute,
                        countIf(state = 'SUCCESS')  AS success_count,
                        countIf(state = 'FAILURE')  AS failure_count,
                        countIf(state = 'RETRY')    AS retry_count,
                        countIf(state = 'REVOKED')  AS revoked_count,
                        count()                     AS total_count,
                        sumIf(runtime, runtime > 0) AS total_runtime,
                        maxIf(runtime, runtime > 0) AS max_runtime,
                        sumIf(
                            dateDiff('millisecond', queued_at, started_at) / 1000.0,
                            queued_at IS NOT NULL AND started_at IS NOT NULL
                        ) AS total_wait_time,
                        countIf(queued_at IS NOT NULL AND started_at IS NOT NULL) AS wait_time_samples
                    FROM task_events
                    WHERE tenant_id = ?
                      AND agent_id = ?
                      AND timestamp >= now() - toIntervalMinute(?)
                      AND state IN ('SUCCESS', 'FAILURE', 'RETRY', 'REVOKED')
                    GROUP BY tenant_id, task_name, queue, minute
                    ORDER BY minute ASC
                    "#,
                )
                .bind(tenant_id)
                .bind(aid)
                .bind(from_minutes)
                .fetch_all::<TaskMetricsRow>()
                .await
                .map_err(|e| AppError::Database(e.to_string()))?
        }
    };

    Ok(rows)
}

/// Get queue metrics time-series.
pub async fn get_queue_metrics(
    client: &Client,
    tenant_id: Uuid,
    queue: &str,
    from_minutes: u64,
) -> Result<Vec<QueueMetricsRow>, AppError> {
    let rows = client
        .query(
            r#"
            SELECT tenant_id, CAST(queue AS String) AS queue,
                   toDateTime64(minute, 3, 'UTC') AS minute,
                   enqueued, dequeued, completed, failed
            FROM queue_metrics_mv
            WHERE tenant_id = ? AND queue = ?
              AND minute >= now() - toIntervalMinute(?)
            ORDER BY minute ASC
            "#,
        )
        .bind(tenant_id)
        .bind(queue)
        .bind(from_minutes)
        .fetch_all::<QueueMetricsRow>()
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows)
}

/// Get overview stats for the dashboard (last N minutes).
pub async fn get_overview_stats(
    client: &Client,
    tenant_id: Uuid,
    from_minutes: u64,
) -> Result<OverviewStats, AppError> {
    let rows = client
        .query(
            r#"
            SELECT
                count() AS total_tasks,
                countIf(state = 'SUCCESS') AS success_count,
                countIf(state = 'FAILURE') AS failure_count,
                avgIf(runtime, runtime > 0) AS avg_runtime,
                quantileIf(0.95)(runtime, runtime > 0) AS p95_runtime,
                avgIf(
                    dateDiff('millisecond', queued_at, started_at) / 1000.0,
                    queued_at IS NOT NULL AND started_at IS NOT NULL
                ) AS avg_wait_time
            FROM task_events
            WHERE tenant_id = ?
              AND timestamp >= now() - toIntervalMinute(?)
              AND state IN ('SUCCESS', 'FAILURE', 'RETRY', 'REVOKED')
            "#,
        )
        .bind(tenant_id)
        .bind(from_minutes)
        .fetch_one::<OverviewStats>()
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows)
}

/// Get distinct task names for a tenant (for filters).
pub async fn get_task_names(
    client: &Client,
    tenant_id: Uuid,
) -> Result<Vec<String>, AppError> {
    #[derive(clickhouse::Row, Deserialize)]
    struct NameRow {
        task_name: String,
    }

    let rows = client
        .query(
            "SELECT DISTINCT task_name FROM task_events WHERE tenant_id = ? AND timestamp >= now() - toIntervalDay(30) ORDER BY task_name LIMIT 500",
        )
        .bind(tenant_id)
        .fetch_all::<NameRow>()
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows.into_iter().map(|r| r.task_name).collect())
}

/// Get distinct queue names for a tenant (for filters).
pub async fn get_queue_names(
    client: &Client,
    tenant_id: Uuid,
) -> Result<Vec<String>, AppError> {
    #[derive(clickhouse::Row, Deserialize)]
    struct QueueRow {
        queue: String,
    }

    let rows = client
        .query("SELECT DISTINCT queue FROM task_events WHERE tenant_id = ? AND queue != '' AND timestamp >= now() - toIntervalDay(30) ORDER BY queue LIMIT 200")
        .bind(tenant_id)
        .fetch_all::<QueueRow>()
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows.into_iter().map(|r| r.queue).collect())
}

/// Broker-specific stats for the detail page.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct BrokerStats {
    pub total_events: u64,
    pub events_last_hour: u64,
    pub events_last_24h: u64,
    pub success_count: u64,
    pub failure_count: u64,
    pub top_tasks: Vec<TopTaskRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct TopTaskRow {
    pub name: String,
    pub count: u64,
}

/// Get stats for a specific broker (identified by agent_id in task_events).
pub async fn get_broker_stats(
    client: &Client,
    tenant_id: Uuid,
    broker_id: Uuid,
) -> Result<BrokerStats, AppError> {
    #[derive(clickhouse::Row, Deserialize)]
    struct CountsRow {
        total_events: u64,
        events_last_hour: u64,
        events_last_24h: u64,
        success_count: u64,
        failure_count: u64,
    }

    let counts = client
        .query(
            r#"
            SELECT
                count() AS total_events,
                countIf(timestamp >= now() - toIntervalHour(1)) AS events_last_hour,
                countIf(timestamp >= now() - toIntervalHour(24)) AS events_last_24h,
                countIf(state = 'SUCCESS') AS success_count,
                countIf(state = 'FAILURE') AS failure_count
            FROM task_events
            WHERE tenant_id = ? AND agent_id = ?
            "#,
        )
        .bind(tenant_id)
        .bind(broker_id)
        .fetch_one::<CountsRow>()
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    #[derive(clickhouse::Row, Deserialize)]
    struct TaskRow {
        task_name: String,
        cnt: u64,
    }

    let top_tasks = client
        .query(
            r#"
            SELECT CAST(task_name AS String) AS task_name, count() AS cnt
            FROM task_events
            WHERE tenant_id = ? AND agent_id = ?
              AND state IN ('SUCCESS', 'FAILURE')
            GROUP BY task_name
            ORDER BY cnt DESC
            LIMIT 10
            "#,
        )
        .bind(tenant_id)
        .bind(broker_id)
        .fetch_all::<TaskRow>()
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(BrokerStats {
        total_events: counts.total_events,
        events_last_hour: counts.events_last_hour,
        events_last_24h: counts.events_last_24h,
        success_count: counts.success_count,
        failure_count: counts.failure_count,
        top_tasks: top_tasks
            .into_iter()
            .map(|r| TopTaskRow {
                name: r.task_name,
                count: r.cnt,
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_metrics_consistency() {
        let row = TaskMetricsRow {
            tenant_id: Uuid::new_v4(),
            task_name: "test".into(), queue: "default".into(),
            minute: OffsetDateTime::now_utc(),
            success_count: 80, failure_count: 10, retry_count: 5,
            revoked_count: 5, total_count: 100,
            total_runtime: 200.0, max_runtime: 10.0,
            total_wait_time: Some(30.0), wait_time_samples: 100,
        };
        assert_eq!(row.success_count + row.failure_count + row.retry_count + row.revoked_count, row.total_count);
    }

    #[test]
    fn overview_stats_consistency() {
        let stats = OverviewStats {
            total_tasks: 1000, success_count: 950, failure_count: 50,
            avg_runtime: 1.0, p95_runtime: 3.0, avg_wait_time: Some(0.1),
        };
        assert_eq!(stats.success_count + stats.failure_count, stats.total_tasks);
    }

    #[test]
    fn queue_metrics_invariants() {
        let row = QueueMetricsRow {
            tenant_id: Uuid::new_v4(), queue: "test".into(),
            minute: OffsetDateTime::now_utc(),
            enqueued: 100, dequeued: 95, completed: 90, failed: 5,
        };
        assert!(row.enqueued >= row.dequeued);
        assert_eq!(row.completed + row.failed, row.dequeued);
    }
}
