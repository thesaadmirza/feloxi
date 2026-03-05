CREATE MATERIALIZED VIEW IF NOT EXISTS queue_metrics_mv
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
FROM task_events
GROUP BY tenant_id, queue, minute;
