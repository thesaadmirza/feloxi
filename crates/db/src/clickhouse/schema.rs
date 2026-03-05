use clickhouse::Client;

const TABLE_STATEMENTS: &[(&str, &str)] = &[
    (
        "task_events",
        "CREATE TABLE IF NOT EXISTS feloxi.task_events (
            tenant_id       UUID,
            event_id        UUID,
            task_id         String,
            task_name       LowCardinality(String),
            queue           LowCardinality(String),
            worker_id       String,
            state           LowCardinality(String),
            event_type      LowCardinality(String),
            timestamp       DateTime64(3, 'UTC') CODEC(DoubleDelta),
            args            String DEFAULT '',
            kwargs          String DEFAULT '',
            result          String DEFAULT '',
            exception       String DEFAULT '',
            traceback       String DEFAULT '',
            runtime         Float64 DEFAULT 0 CODEC(Gorilla),
            retries         UInt32 DEFAULT 0,
            root_id         Nullable(String),
            parent_id       Nullable(String),
            group_id        Nullable(String),
            chord_id        Nullable(String),
            queued_at       Nullable(DateTime64(3, 'UTC')),
            started_at      Nullable(DateTime64(3, 'UTC')),
            agent_id        UUID,
            broker_type     LowCardinality(String),
            ingested_at     DateTime64(3, 'UTC') DEFAULT now64(3)
        )
        ENGINE = MergeTree()
        PARTITION BY (tenant_id, toYYYYMM(timestamp))
        ORDER BY (tenant_id, task_name, timestamp, task_id)
        TTL toDateTime(timestamp) + INTERVAL 90 DAY
        SETTINGS index_granularity = 8192",
    ),
    (
        "worker_events",
        "CREATE TABLE IF NOT EXISTS feloxi.worker_events (
            tenant_id       UUID,
            event_id        UUID,
            worker_id       String,
            hostname        LowCardinality(String),
            event_type      LowCardinality(String),
            timestamp       DateTime64(3, 'UTC') CODEC(DoubleDelta),
            active_tasks    UInt32 DEFAULT 0,
            processed       UInt64 DEFAULT 0,
            load_avg        Array(Float64),
            cpu_percent     Float64 DEFAULT 0 CODEC(Gorilla),
            memory_mb       Float64 DEFAULT 0 CODEC(Gorilla),
            pool_size       UInt32 DEFAULT 0,
            pool_type       LowCardinality(String),
            sw_ident        LowCardinality(String),
            sw_ver          LowCardinality(String),
            agent_id        UUID,
            ingested_at     DateTime64(3, 'UTC') DEFAULT now64(3)
        )
        ENGINE = MergeTree()
        PARTITION BY (tenant_id, toYYYYMM(timestamp))
        ORDER BY (tenant_id, worker_id, timestamp)
        TTL toDateTime(timestamp) + INTERVAL 30 DAY
        SETTINGS index_granularity = 8192",
    ),
    (
        "task_metrics_mv",
        "CREATE MATERIALIZED VIEW IF NOT EXISTS feloxi.task_metrics_mv
        ENGINE = SummingMergeTree()
        PARTITION BY (tenant_id, toYYYYMM(minute))
        ORDER BY (tenant_id, task_name, queue, minute)
        AS SELECT
            tenant_id,
            task_name,
            queue,
            toStartOfMinute(timestamp) AS minute,
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
        FROM feloxi.task_events
        WHERE state IN ('SUCCESS', 'FAILURE', 'RETRY', 'REVOKED')
        GROUP BY tenant_id, task_name, queue, minute",
    ),
    (
        "queue_metrics_mv",
        "CREATE MATERIALIZED VIEW IF NOT EXISTS feloxi.queue_metrics_mv
        ENGINE = SummingMergeTree()
        PARTITION BY (tenant_id, toYYYYMM(minute))
        ORDER BY (tenant_id, queue, minute)
        AS SELECT
            tenant_id,
            queue,
            toStartOfMinute(timestamp) AS minute,
            countIf(event_type = 'task-sent')     AS enqueued,
            countIf(event_type = 'task-started')  AS dequeued,
            countIf(event_type = 'task-succeeded') AS completed,
            countIf(event_type = 'task-failed')   AS failed
        FROM feloxi.task_events
        GROUP BY tenant_id, queue, minute",
    ),
];

pub async fn run_schema_init(
    url: &str,
    user: Option<&str>,
    password: Option<&str>,
) -> Result<(), String> {
    let mut bootstrap = Client::default().with_url(url);
    if let Some(u) = user {
        bootstrap = bootstrap.with_user(u);
    }
    if let Some(p) = password {
        bootstrap = bootstrap.with_password(p);
    }
    bootstrap
        .query("CREATE DATABASE IF NOT EXISTS feloxi")
        .execute()
        .await
        .map_err(|e| format!("ClickHouse schema init failed on database: {e}"))?;

    let client = bootstrap.with_database("feloxi");
    for (name, ddl) in TABLE_STATEMENTS {
        client
            .query(ddl)
            .execute()
            .await
            .map_err(|e| format!("ClickHouse schema init failed on {name}: {e}"))?;
    }
    Ok(())
}
