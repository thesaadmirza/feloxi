CREATE MATERIALIZED VIEW IF NOT EXISTS task_metrics_mv
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
FROM task_events
WHERE state IN ('SUCCESS', 'FAILURE', 'RETRY', 'REVOKED')
GROUP BY tenant_id, task_name, queue, minute;
