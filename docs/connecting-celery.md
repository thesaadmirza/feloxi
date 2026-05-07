# Connecting Your Celery App to Feloxi

Feloxi reads the events that Celery already emits — no agent to install, no
SDK to wrap your tasks with. You enable event publishing in your Celery config,
then register your broker URL in the Feloxi dashboard. That's it.

---

## Step 1 — Enable event publishing in Celery

Add these three settings to your Celery configuration. If you use a
`celeryconfig.py` file:

```python
# celeryconfig.py

# Send task-started, task-succeeded, task-failed, task-retried events.
worker_send_task_events = True

# Send task-sent when a task is published (shows PENDING state in Feloxi).
task_send_sent_event = True

# Send task-started when a worker begins executing (lets you measure queue
# wait time vs. actual execution time in Feloxi's task detail view).
task_track_started = True
```

If you configure Celery inline:

```python
from celery import Celery

app = Celery("myapp")
app.conf.update(
    worker_send_task_events=True,
    task_send_sent_event=True,
    task_track_started=True,
)
```

### Restart your workers with the `--events` flag

The config settings above tell the worker *what* to send. The `--events` flag
tells the worker process to *start* the event dispatcher:

```bash
celery -A myapp worker --loglevel=info --events
```

Or, if you run workers with `celery multi` or a process manager, add
`--events` to each worker command. Both settings *and* the flag are needed —
one without the other produces no events.

### Verify locally

```bash
celery -A myapp inspect active_queues   # should list your queues
celery -A myapp control enable_events   # enable events on running workers
```

---

## Step 2 — Add your broker in Feloxi

### Via the dashboard

1. Open Feloxi at [http://localhost:3000](http://localhost:3000) and sign in
2. Click **Brokers** in the left sidebar
3. Click **Add Broker**
4. Fill in the form:

| Field | Redis | RabbitMQ |
|-------|-------|---------|
| Name | `My Redis Broker` | `My RabbitMQ Broker` |
| Type | Redis | RabbitMQ |
| URL | `redis://host:6379` | `amqp://user:pass@host:5672//` |

5. Click **Test Connection** — Feloxi opens a connection and confirms it can
   subscribe to the event stream
6. Click **Connect**

Feloxi immediately starts consuming events from the broker. The **Tasks** page
will show tasks within seconds of your next worker run.

### Via the REST API

Useful for scripting or infrastructure-as-code setups. First obtain a token:

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@feloxi.dev","password":"password123"}' \
  | jq -r '.access_token')
```

Then register the broker:

```bash
# Redis
curl -X POST http://localhost:8080/api/v1/brokers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production Redis",
    "broker_type": "redis",
    "connection_url": "redis://your-redis-host:6379"
  }'

# RabbitMQ
curl -X POST http://localhost:8080/api/v1/brokers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production RabbitMQ",
    "broker_type": "rabbitmq",
    "connection_url": "amqp://user:pass@your-rabbitmq-host:5672//"
  }'
```

The response includes the broker `id`. You can use it later to start/stop the
connection or retrieve per-broker stats.

---

## What happens after you connect

1. **Consumer starts** — Feloxi spawns a background task that subscribes to
   `/celeryev/*` on Redis pub/sub, or binds a fanout exchange on AMQP
2. **Events decode** — Kombu envelopes are decoded, event types are normalized
   to states (`task-succeeded` → `SUCCESS`, etc.)
3. **Batch insert** — events are buffered and flushed to ClickHouse every 1
   second (or when the batch hits 100 events)
4. **Redis state update** — live worker state is updated in Redis cache
5. **WebSocket broadcast** — the dashboard receives the update and re-renders
   without a page refresh

The first events are visible in the dashboard typically within 2–5 seconds of
a task being executed by a worker.

---

## Multiple brokers

You can connect Feloxi to multiple brokers simultaneously — staging and
production, or Redis and RabbitMQ side by side. Each broker runs an independent
consumer. Stats and task history are segmented per broker in the UI.

---

## Troubleshooting

### Workers don't appear on the Workers page

- Confirm `worker_send_task_events = True` is in your config
- Confirm workers are started with `--events`
- Check broker status in **Brokers** — it should show `connected`
- Run `celery -A myapp inspect ping` — if workers don't respond, they're not
  connected to the broker

### Tasks appear but show no STARTED state

- `task_track_started = True` is missing from your config, or workers were not
  restarted after adding it

### Tasks appear but show no PENDING state

- `task_send_sent_event = True` is missing from your config
- Note: PENDING requires the producer to send the event when publishing the
  task, not the worker. The producer needs the same config settings.

### Broker shows "error" status in Feloxi

- Connection URL is incorrect — verify it by testing the broker in the UI
- Network issue between the Feloxi API container and your broker host
- For Redis: check that the Redis DB number matches (default: 0)
- For RabbitMQ: check vhost (`/` in the URL), username, and password

### Events flow for a minute then stop

- Redis pub/sub disconnects are handled with exponential backoff and automatic
  reconnection — check `RUST_LOG=api=debug` logs for reconnect messages
- For RabbitMQ, the consumer declares an exclusive, auto-delete queue — if the
  connection drops, a new queue is declared on reconnect

### Queue depths are always zero

- Queue depth tracking requires your Celery broker to use list-based queues
  (default for most setups). Virtual queues or custom routing may not be
  reflected
- Depths update every `FP_DRAIN_INTERVAL_SECS` (default: 30s), not in real time

---

## Connecting from Kubernetes

If Feloxi runs in Kubernetes and your broker is external, use the cluster-internal
service name or an external hostname:

```yaml
# broker URL examples for common setups
redis://redis-service.my-namespace.svc.cluster.local:6379
redis://elasticache.us-east-1.amazonaws.com:6379

amqp://user:pass@rabbitmq-service.my-namespace.svc.cluster.local:5672//
amqp://user:pass@b-abc123.mq.us-east-1.amazonaws.com:5671//
```

The Feloxi API pod needs network access to the broker. If your broker requires
TLS, the URL scheme changes:

- Redis with TLS: `rediss://host:6380`
- RabbitMQ with TLS: `amqps://user:pass@host:5671//`
