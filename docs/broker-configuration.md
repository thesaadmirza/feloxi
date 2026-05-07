# Broker Configuration and Performance Tuning

This document covers how Feloxi connects to Celery brokers, what happens
internally when events flow through the pipeline, and which knobs to turn for
high-throughput deployments.

---

## How Feloxi consumes broker events

Feloxi doesn't poll your broker — it subscribes to the Celery event stream and
processes events as they arrive.

```
Celery Worker
    │
    │  Publishes Kombu-encoded events to:
    │  • Redis: pub/sub channel  /celeryev/*
    │  • RabbitMQ: fanout exchange  celeryev
    ▼
Broker (Redis / RabbitMQ)
    │
    │  Feloxi subscribes at broker connect time
    ▼
BrokerConnectionManager (Feloxi API)
    │
    ├─ Decode Kombu envelope (base64 + JSON)
    ├─ Extract event type from headers or body
    ├─ Normalize: task-succeeded → SUCCESS
    │
    ├─ Batch task events ──► ClickHouse (history)
    ├─ Update worker state ──► Redis cache (live)
    └─ Broadcast ──► WebSocket (dashboard)
```

### Redis consumer

Feloxi uses Redis pub/sub (not Streams). It subscribes to the pattern
`/celeryev/*`, which covers all Celery event channels regardless of Redis
database number. The consumer reconnects automatically on disconnect with
exponential backoff (0–100ms initial, doubles per attempt, 30s cap).

### RabbitMQ / AMQP consumer

Feloxi declares a `celeryev` fanout exchange (durable), creates an exclusive
auto-delete queue bound with routing key `#` (all messages), and consumes with
`no_ack=true`. On disconnect, it retries up to 3 times with 2^n second delays
(2s, 4s, 8s), then marks the broker as `error`.

---

## Broker status values

| Status | Meaning |
|--------|---------|
| `connected` | Consumer is active and receiving events |
| `error` | Connection failed — check URL and network. Feloxi will not retry automatically; stop and restart the broker in the UI |
| `disconnected` | Manually stopped via the UI or API |

To recover from `error` state: go to **Brokers**, click the broker, and click
**Reconnect**.

---

## Performance tuning (FP_* env vars)

All of these are optional. The defaults handle most deployments well. Only tune
when you see specific symptoms.

### Ingestion pipeline

| Variable | Default | Description |
|----------|---------|-------------|
| `FP_TASK_BATCH_SIZE` | `100` | Number of task events to buffer before flushing to ClickHouse. Higher values reduce ClickHouse write frequency but increase latency. |
| `FP_WORKER_BATCH_SIZE` | `20` | Same for worker events. Worker events are deduplicated within each batch — only the latest state per worker is written. |
| `FP_FLUSH_INTERVAL_SECS` | `1` | Maximum seconds to hold a partial batch before flushing, even if batch size hasn't been reached. Lower values reduce dashboard latency. |

**When to change:**
- Events are not appearing in the dashboard promptly → lower `FP_FLUSH_INTERVAL_SECS` to `0.5`
- ClickHouse write errors under high load → increase `FP_TASK_BATCH_SIZE` to `500`
- Deploying Celery at 50K+ workers → increase `FP_WORKER_BATCH_SIZE` to `100`

### Redis pub/sub buffer

| Variable | Default | Description |
|----------|---------|-------------|
| `FP_PUBSUB_CHANNEL_CAPACITY` | `10000` | Size of the internal Tokio channel between the Redis pub/sub reader and the batch processor. If this fills up, new events are dropped and a warning is logged. |

**When to change:**
- Log shows `"PubSub receiver lagged"` → double this value
- Sustained event rate above ~1000 events/sec from a single broker → increase to `50000`

### Stats and logging

| Variable | Default | Description |
|----------|---------|-------------|
| `FP_STATS_INTERVAL_SECS` | `30` | How often queue depth snapshots are written to Redis. Lower values give fresher queue depth readings in the UI. |
| `FP_DRAIN_INTERVAL_SECS` | `30` | How often the consumer drains list-based Celery queues for depth counting. |
| `FP_DRAIN_MAX_MESSAGES` | `500` | Maximum messages to inspect per drain cycle. Higher values are more accurate for deep queues but take longer. |

### Database pools

| Variable | Default | Description |
|----------|---------|-------------|
| `FP_PG_MAX_CONNECTIONS` | `50` | PostgreSQL connection pool size. Increase for deployments with many concurrent API users or frequent alert evaluations. |
| `FP_REDIS_POOL_SIZE` | `50` | Redis connection pool size. Increase if you see connection wait times under high WebSocket concurrency. |

---

## Sizing examples

### Small deployment (< 10 workers, < 100K tasks/day)

Defaults are fine. No tuning needed.

```bash
# No FP_* vars needed
```

### Medium deployment (10–100 workers, 100K–1M tasks/day)

```bash
FP_TASK_BATCH_SIZE=200
FP_WORKER_BATCH_SIZE=50
FP_FLUSH_INTERVAL_SECS=1
FP_PUBSUB_CHANNEL_CAPACITY=20000
```

### Large deployment (100–1000 workers, 1M–10M tasks/day)

```bash
FP_TASK_BATCH_SIZE=500
FP_WORKER_BATCH_SIZE=100
FP_FLUSH_INTERVAL_SECS=2
FP_PUBSUB_CHANNEL_CAPACITY=50000
FP_PG_MAX_CONNECTIONS=100
FP_REDIS_POOL_SIZE=100
FP_STATS_INTERVAL_SECS=60
```

See [sizing.md](sizing.md) for full resource planning including ClickHouse
storage estimates and API horizontal scaling guidance.

---

## Multiple brokers

Each broker connection runs as an independent consumer in Feloxi. You can
connect multiple Redis instances, multiple RabbitMQ clusters, or a mix of both.
Each consumer has its own batching and reconnect logic. Stats and task history
are segmented per broker in the API and UI.

There is no limit on the number of brokers, but each adds a background Tokio
task and opens connections to the databases. With 10+ brokers, consider
increasing `FP_PG_MAX_CONNECTIONS` proportionally.

---

## Broker URL formats

### Redis

```
redis://host:port/db
redis://:password@host:port/db     # with auth
rediss://host:port/db              # TLS
redis://host:6379/0                # explicit DB 0
```

Celery's `BROKER_URL` and Feloxi's connection URL must point to the same Redis
instance and database number. Feloxi subscribes to pub/sub channels that include
the DB suffix (`/celeryev/0`, `/celeryev/1`, etc.) and handles all of them.

### RabbitMQ

```
amqp://user:password@host:5672/vhost
amqp://guest:guest@localhost:5672//     # default vhost
amqps://user:password@host:5671/vhost  # TLS
```

The vhost at the end of the URL (`/` or `//` for the default vhost) must match
what your Celery workers use.

---

## Event types reference

Feloxi normalizes all Celery event types into a unified state model.

| Celery event type | Feloxi state | Description |
|-------------------|-------------|-------------|
| `task-sent` | `PENDING` | Task published to broker, not yet received by a worker |
| `task-received` | `RECEIVED` | Worker received the task from the queue |
| `task-started` | `STARTED` | Worker began executing the task |
| `task-succeeded` | `SUCCESS` | Task completed without error |
| `task-failed` | `FAILURE` | Task raised an exception |
| `task-retried` | `RETRY` | Task raised a retryable exception; will be re-queued |
| `task-revoked` | `REVOKED` | Task was revoked via `celery control revoke` |
| `task-rejected` | `REJECTED` | Task was rejected by the worker |

Worker events:

| Celery event type | What Feloxi stores |
|-------------------|--------------------|
| `worker-online` | State transition → online. Stored in ClickHouse and Redis. |
| `worker-offline` | State transition → offline. Stored in ClickHouse and Redis. |
| `worker-heartbeat` | Sampled only — used to update Redis live state. Not written to ClickHouse for every heartbeat to avoid table bloat. |

The heartbeat carries CPU percent, memory MB, load averages, pool size, and
active task count. These appear on the Workers page and update every heartbeat
interval (typically 2s in Celery's default config).
