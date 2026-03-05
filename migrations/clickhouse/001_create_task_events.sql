CREATE TABLE IF NOT EXISTS task_events (
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
SETTINGS index_granularity = 8192;
