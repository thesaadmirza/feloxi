# Sizing Guide

Resource requirements for running Feloxi at different scales.

## Quick Reference

| Scale | Tasks/Day | Workers | API | ClickHouse | Redis | PostgreSQL |
|-------|----------|---------|-----|------------|-------|------------|
| **Small** | < 100K | < 10 | 1 CPU, 512 MB | 1 CPU, 1 GB | 256 MB | 256 MB |
| **Medium** | 100K–1M | 10–100 | 2 CPU, 1 GB | 2 CPU, 4 GB | 512 MB | 512 MB |
| **Large** | 1M–10M | 100–500 | 4 CPU, 2 GB | 4 CPU, 16 GB | 1 GB | 1 GB |
| **XL** | 10M+ | 500+ | 8 CPU, 4 GB | 8 CPU, 32 GB+ | 2 GB | 1 GB |

## Component Breakdown

### API Server (Rust)

The API server is CPU-bound for event processing and memory-light.

- **CPU**: Scales linearly with event throughput. Estimate ~5,000 events/sec per core (conservative).
- **Memory**: Base ~50 MB. Grows with concurrent WebSocket connections and in-flight broker batches.
- **Scaling**: Stateless. Run multiple instances behind a load balancer for higher throughput.
- **Disk**: No local disk requirements. All state is in external databases.

### ClickHouse

ClickHouse is the primary storage cost driver.

- **Storage**: ~100 bytes per compressed task event (ClickHouse achieves ~10x compression on event data). At 1M events/day with 90-day retention: ~900 MB compressed.
- **Memory**: ClickHouse benefits from large memory for query caches. 1 GB minimum, 4+ GB recommended for analytical queries.
- **CPU**: Needed for materialized view updates and aggregation queries. 2+ cores for production.
- **IOPS**: SSD recommended. Writes are sequential (MergeTree), reads are column-oriented.

**Storage estimates by scale:**

| Tasks/Day | Retention | Estimated Storage |
|----------|-----------|-------------------|
| 100K | 90 days | ~90 MB |
| 1M | 90 days | ~900 MB |
| 10M | 90 days | ~9 GB |
| 10M | 365 days | ~36 GB |

### Redis

Redis stores live worker state and heartbeats. Memory usage is proportional to the number of workers and queues, not event volume.

- **Per worker**: ~2 KB (state JSON + heartbeat + online set member)
- **Per queue**: ~100 bytes (depth counter + active set member)
- **TTLs**: Worker state keys expire after 300–600 seconds, so memory is naturally bounded
- **Estimate**: 100 workers × 2 KB + overhead = ~1 MB. Even 10,000 workers fit in < 50 MB.

### PostgreSQL

PostgreSQL stores only configuration data. Size is negligible at any scale.

- **Tables**: tenants, users, roles, broker_configs, alert_rules, alert_history, api_keys, refresh_tokens, retention_policies
- **Estimate**: < 100 MB even with thousands of users and alert rules
- **Growth**: Alert history is the largest table. At 100 alerts/day, ~36K rows/year, ~10 MB.

## Docker Compose Resource Limits

For production, add resource constraints via `docker-compose.prod.yml`:

```yaml
services:
  api:
    deploy:
      resources:
        limits:
          cpus: "2"
          memory: 1G
        reservations:
          cpus: "0.5"
          memory: 256M

  clickhouse:
    deploy:
      resources:
        limits:
          cpus: "4"
          memory: 8G
        reservations:
          cpus: "1"
          memory: 2G

  redis:
    deploy:
      resources:
        limits:
          cpus: "1"
          memory: 512M

  postgres:
    deploy:
      resources:
        limits:
          cpus: "1"
          memory: 512M
```

## Data Retention

Retention policies control how long ClickHouse keeps event data. Configure via **Settings > Retention** in the dashboard or via the API.

| Resource | Default | Configurable |
|----------|---------|-------------|
| Task events | 90 days | Yes |
| Worker events | 30 days | Yes |
| Alert history | 365 days | Yes |

Retention is enforced by the API server (runs every hour) by applying ClickHouse `ALTER TABLE ... MODIFY TTL` commands. Reducing retention frees disk space on the next ClickHouse merge cycle.

## Scaling Strategies

### Vertical (simplest)

Add more CPU and memory to the host machine. This is sufficient for most deployments up to ~5M tasks/day.

### Horizontal

- **API**: Run multiple instances behind a load balancer. WebSocket connections need session affinity.
- **ClickHouse**: Use ClickHouse [ReplicatedMergeTree](https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/replication) for HA, or a managed service for zero-ops scaling.
- **Redis**: Use Redis Sentinel or a managed Redis for HA. Feloxi's Redis usage is low-volume, so sharding is rarely needed.
- **PostgreSQL**: Use a managed service with read replicas if needed (unlikely — Feloxi's PG load is minimal).
