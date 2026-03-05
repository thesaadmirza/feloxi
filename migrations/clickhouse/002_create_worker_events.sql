CREATE TABLE IF NOT EXISTS worker_events (
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
SETTINGS index_granularity = 8192;
