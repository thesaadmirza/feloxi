# Integration Tests

End-to-end tests that verify Feloxi correctly ingests real Celery events from
real brokers. Tests use `testcontainers` to spin up Redis and RabbitMQ in Docker,
submit actual Celery tasks, and assert the Feloxi REST API returns the expected data.

---

## Prerequisites

- Docker running
- Feloxi API running (see below)
- Python 3.11+

---

## Setup

Install dependencies:

```bash
pip install -r tests/integration/requirements.txt
```

Start Feloxi (from the repo root):

```bash
cp .env.example .env
docker compose up -d postgres clickhouse redis feloxi-api seed
```

Wait for the API to be healthy:

```bash
docker compose ps feloxi-api   # Status should be "healthy"
```

---

## Running

Run all integration tests:

```bash
pytest tests/integration/ -v
```

Run a specific broker's tests:

```bash
pytest tests/integration/test_redis_broker.py -v
pytest tests/integration/test_amqp_broker.py -v
pytest tests/integration/test_worker_events.py -v
```

Run with a custom API URL (if Feloxi is on a non-default port):

```bash
FELOXI_API_URL=http://localhost:9090 pytest tests/integration/ -v
```

---

## How it works

Each test:

1. Starts a real broker container (Redis or RabbitMQ) via `testcontainers`
2. Registers the broker in Feloxi via `POST /api/v1/brokers`
3. Starts a Celery worker subprocess connected to that broker
4. Submits tasks and waits for them to complete
5. Polls the Feloxi API until the expected state appears (up to 30s timeout)
6. Asserts the response matches expectations
7. Tears down: stops the worker, deregisters the broker, stops the container

The tests import task code from `examples/app/tasks/` — the same tasks used in
the example Docker Compose, so integration tests exercise real task behavior.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FELOXI_API_URL` | `http://localhost:8080` | Feloxi API endpoint |
| `FELOXI_EMAIL` | `demo@feloxi.dev` | Test user email |
| `FELOXI_PASSWORD` | `password123` | Test user password |
| `WORKER_STARTUP_TIMEOUT` | `15` | Seconds to wait for a worker to come online |
| `EVENT_TIMEOUT` | `30` | Seconds to wait for events to appear in Feloxi API |

---

## CI notes

These tests require Docker. In CI (GitHub Actions), they run in a job with
`services:` or via `docker-in-docker`. They are not part of the standard
`ci-rust.yml` or `ci-frontend.yml` pipelines — run them as a separate job or
locally before a release.
