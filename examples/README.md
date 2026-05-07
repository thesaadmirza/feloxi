# Feloxi Example App

A self-contained demo that runs Feloxi alongside real Celery workers. All tasks
flow through an actual broker (Redis or RabbitMQ), get consumed by the Feloxi
API, and appear in the dashboard in real time.

Use this to see what "plug in your Celery app" looks like end-to-end — or as a
starting point for building your own integration.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 24+
- [Docker Compose](https://docs.docker.com/compose/install/) v2

No Python, Rust, or Node.js required on the host — everything runs in containers.

---

## Quick start — Redis broker

Redis is the most common Celery broker. This uses a single Redis instance for
both the Celery broker and Feloxi's internal state.

```bash
cd examples
docker compose up -d
```

The first build takes a few minutes (compiling the Rust API). Subsequent starts
are fast. Watch progress with:

```bash
docker compose logs -f feloxi-api
```

When the API is healthy, open [http://localhost:3000](http://localhost:3000) and sign in:

| Field    | Value             |
|----------|-------------------|
| Email    | `demo@feloxi.dev` |
| Password | `password123`     |

Connect Feloxi to the Celery broker:

1. Go to **Brokers** in the left sidebar
2. Click **Add Broker**
3. Select **Redis**, enter `redis://redis:6379`, click **Test Connection**
4. Click **Connect**

Tasks start appearing in the **Tasks** tab within a few seconds. Workers show
up on the **Workers** page. Queue depths update every 30 seconds.

---

## Quick start — RabbitMQ broker

Same Celery app, different broker. Feloxi connects to RabbitMQ via AMQP.

```bash
cd examples
docker compose -f docker-compose.yml -f docker-compose.rabbitmq.yml up -d
```

After startup, add the broker in Feloxi:

- **Type**: RabbitMQ
- **URL**: `amqp://guest:guest@rabbitmq:5672//`

RabbitMQ management UI is available at [http://localhost:15672](http://localhost:15672)
(guest / guest) — useful for inspecting queues and message rates from RabbitMQ's side.

---

## What you'll see

| Page | What's happening |
|------|-----------------|
| **Dashboard** | Throughput chart updates every ~5s. Failure rate shows ~12% from payment tasks. |
| **Tasks** | Real tasks: email, payments, media, data, and workflow chains. |
| **Workers** | Four worker groups (default, payments, media, data) with CPU, memory, and pool stats. |
| **Brokers** | Live connection status. Queue depths for default, emails, payments, media, data. |
| **Workflows** | Click a task in a chain — the DAG view shows all linked tasks in the pipeline. |

The load generator submits ~2 tasks/sec (configurable via `TASKS_PER_SEC` in `.env`).
The task mix includes ~70% success, ~12% failure, ~10% retry, and some revokes —
so all states appear in the dashboard.

Beat tasks fire on schedule: a health check every 30s, inventory sync every 2
minutes, and a digest email every 5 minutes.

---

## Task types

| Task | Queue | Typical runtime | Failure rate |
|------|-------|----------------|-------------|
| `send_welcome_email` | emails | 50–300ms | ~0% |
| `send_digest_email` | emails | 100–500ms | ~4% (retry) |
| `process_payment` | payments | 200ms–1.5s | ~12% |
| `refund_payment` | payments | 300ms–1s | ~3% (retry) |
| `validate_payment_method` | payments | 50–400ms | ~6% |
| `resize_image` | media | 500ms–3s | ~5% |
| `transcode_video` | media | 5–20s | ~8% |
| `generate_thumbnail` | media | 300ms–1.5s | ~0% |
| `import_csv` | data | 500ms–4s | ~7% |
| `generate_report` | data | 1–8s | ~6% |
| `backup_database` | data | 500ms–3s | ~3% (retry) |
| `sync_inventory` | data | 300ms–2s | ~8% (retry) |

Workflow tasks (`process_new_user`, `process_batch_images`, `generate_monthly_report`)
use Celery chains, groups, and chords — they show as linked DAGs in Feloxi.

---

## Scaling workers

Scale any worker tier without stopping the stack:

```bash
# Run 5 default-queue workers
docker compose up --scale worker-default=5 -d

# Run 3 payment workers and 2 media workers
docker compose up --scale worker-payments=3 --scale worker-media=2 -d
```

New workers appear in Feloxi's Workers page within 60 seconds. Feloxi
deduplicates worker state so 50K+ workers don't overwhelm the dashboard.

---

## Connecting your own Celery app instead

If you have an existing Celery app, you don't need this example at all. Two steps:

**Step 1**: Add three lines to your `celeryconfig.py` (or `app.conf`):

```python
worker_send_task_events = True
task_send_sent_event = True
task_track_started = True
```

Then restart your workers with the `--events` flag:

```bash
celery -A myapp worker --events
```

**Step 2**: Start Feloxi and add your broker in the dashboard:

```bash
# If using the main docker-compose.yml at the repo root:
cd ..
cp .env.example .env
docker compose up -d
# Open http://localhost:3000 → Brokers → Add Broker
```

See [../docs/connecting-celery.md](../docs/connecting-celery.md) for a detailed guide
including API-based broker registration and troubleshooting.

---

## Stopping

```bash
# Stop containers, keep volumes (data survives restart)
docker compose down

# Stop and delete all data
docker compose down -v
```

For the RabbitMQ variant, stop with the same compose files you used to start:

```bash
docker compose -f docker-compose.yml -f docker-compose.rabbitmq.yml down -v
```

---

## File structure

```
examples/
├── README.md                    # This file
├── docker-compose.yml           # Full stack with Redis broker
├── docker-compose.rabbitmq.yml  # Override: swap broker to RabbitMQ
├── .env                         # Tunable vars (TASKS_PER_SEC, etc.)
│
└── app/                         # Python Celery application
    ├── Dockerfile
    ├── requirements.txt
    ├── app.py                   # Celery app factory
    ├── celeryconfig.py          # All settings with explanations
    ├── beat_schedule.py         # Periodic task definitions
    ├── generate_load.py         # Continuous task stream
    └── tasks/
        ├── email.py             # Email tasks → emails queue
        ├── payments.py          # Payment tasks → payments queue
        ├── media.py             # Media tasks → media queue
        ├── data.py              # Data tasks → data queue
        └── workflows.py        # Chains, groups, chords
```

---

## Configuration reference

| Variable | Default | Description |
|----------|---------|-------------|
| `TASKS_PER_SEC` | `2` | Load generator rate (tasks/second) |
| `CELERY_BROKER_URL` | `redis://redis:6379/0` | Celery broker URL (per worker service) |
| `CELERY_RESULT_BACKEND` | `redis://redis:6379/1` | Celery result backend |

Feloxi configuration (API, databases, auth) is documented in
[../docs/configuration.md](../docs/configuration.md) and
[../docs/broker-configuration.md](../docs/broker-configuration.md).
