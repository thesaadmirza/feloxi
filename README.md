<p align="center">
  <img src="https://raw.githubusercontent.com/thesaadmirza/feloxi/main/.github/logo.svg" alt="Feloxi" width="120" />
</p>

<h1 align="center">Feloxi</h1>

<p align="center">
  <strong>Self-hosted monitoring for Python task queues.</strong><br/>
  Live dashboards, searchable task history, and alerting that fires.
</p>

<p align="center">
  <a href="https://github.com/thesaadmirza/feloxi/actions/workflows/ci-rust.yml"><img src="https://img.shields.io/github/actions/workflow/status/thesaadmirza/feloxi/ci-rust.yml?branch=main&label=Rust%20CI&style=flat-square" alt="Rust CI" /></a>
  <a href="https://github.com/thesaadmirza/feloxi/actions/workflows/ci-frontend.yml"><img src="https://img.shields.io/github/actions/workflow/status/thesaadmirza/feloxi/ci-frontend.yml?branch=main&label=Frontend%20CI&style=flat-square" alt="Frontend CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue?style=flat-square" alt="License" /></a>
  <a href="https://github.com/thesaadmirza/feloxi/releases"><img src="https://img.shields.io/github/v/release/thesaadmirza/feloxi?include_prereleases&style=flat-square&label=Release" alt="Release" /></a>
  <a href="charts/feloxi"><img src="https://img.shields.io/badge/Helm-0F1689?style=flat-square&logo=helm&logoColor=white" alt="Helm Chart" /></a>
</p>

---

<p align="center">
  <img src=".github/screenshots/dashboard.png" width="900" alt="Feloxi dashboard with throughput, failure-rate trends, top failing tasks, and worker leaderboard" />
</p>

Feloxi is a self-hosted Celery monitoring platform. It connects to your broker (Redis or RabbitMQ), reads the events Celery already emits, and stores them in ClickHouse so they outlive a restart. The dashboard runs on WebSocket for live updates. There's no agent to install and no SDK to integrate.

## What you can do

### Find any task

Full-text search across task ID, name, args, kwargs, result, and exception. Filter by state, worker, and time range. Click any task for the state timeline, traceback, runtime, retries, and retry/revoke actions sent through the broker.

<p align="center">
  <img src=".github/screenshots/tasks.png" width="900" alt="Task explorer with full-text search, state filters, time range chips, and detail view" />
</p>

### Watch worker health

CPU, memory, pool size, active task counts, and heartbeat gaps. Load averages over 1m/5m/15m. Remote shutdown from the UI. Color-coded health indicators at a glance.

<p align="center">
  <img src=".github/screenshots/workers.png" width="900" alt="Worker monitoring with CPU, memory, and pool stats" />
</p>

### Visualize workflows

Celery chains, groups, and chords rendered as interactive DAGs. When a multi-stage pipeline fails, you can see which step broke without reading logs or correlating task IDs.

<p align="center">
  <img src=".github/screenshots/workflow-chain.png" width="900" alt="Workflow chain visualized as an interactive DAG" />
</p>

### Alert on what matters

Ten alert condition types: failure rate, slow tasks, worker offline, queue depth, throughput anomaly, latency anomaly, error rate spike, beat missed, no events, task failed. Route to Slack, email, webhook, or PagerDuty. Cooldown periods prevent alert storms. Delivery logs show which channels actually received each firing.

<p align="center">
  <img src=".github/screenshots/alerts.png" width="900" alt="Alert rules with conditions and channel routing" />
</p>

### Manage brokers in one place

Add Redis or RabbitMQ brokers through a 3-step wizard with connection testing. Start, stop, and monitor each broker independently. Per-broker stats include total events, hourly throughput, success rate, queue depths, and top tasks. Monitor staging and production from the same dashboard.

<p align="center">
  <img src=".github/screenshots/brokers.png" width="900" alt="Broker management with live queue depths" />
</p>

## Quick start

```bash
git clone https://github.com/thesaadmirza/feloxi.git
cd feloxi
cp .env.example .env
docker compose up -d
```

This boots PostgreSQL, ClickHouse, Redis, the Rust API server, the Next.js frontend, and seeds 50,000 task events across 6 simulated workers. Open [http://localhost:3000](http://localhost:3000) and sign in:

| Field    | Value             |
| -------- | ----------------- |
| Email    | `demo@feloxi.dev` |
| Password | `password123`     |

### Connect your workers

Enable Celery events on your existing workers. No agent required.

```bash
celery -A myapp worker --loglevel=info --events
```

Or in `celeryconfig.py`:

```python
worker_send_task_events = True
task_send_sent_event = True
```

Then add your broker URL in the dashboard under **Brokers → Add Broker**. Events start flowing as soon as the connection is live.

## Architecture

```
Celery Workers ──events──> Broker (Redis / RabbitMQ)
                                    |
                              +-----------+
                              | Feloxi    |
                              | API       | :8080
                              | (Rust)    |
                              +--+--+--+--+
                                 |  |  |
                        +--------+  |  +--------+
                        v           v           v
                  +----------+ +----------+ +----------+
                  |PostgreSQL| |ClickHouse| |  Redis   |
                  | Auth &   | |  Events  | |Real-time |
                  | Config   | |& Metrics | |  State   |
                  +----------+ +----------+ +----------+
                                    |
                              +-----------+
                              | Next.js   | :3000
                              | Frontend  |
                              +-----------+
```

| Component                       | Role                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| **Rust API** (Axum, Tokio)      | HTTP + WebSocket server, broker consumers, alert evaluation, retention enforcement |
| **Next.js Frontend** (React 19) | Dashboard, task explorer, worker monitoring, broker management, settings           |
| **PostgreSQL 17**               | Users, tenants, roles, broker configs, alert rules, API keys, retention policies   |
| **ClickHouse 24.12**            | Task events, worker events, materialized views for metrics aggregation             |
| **Redis 7**                     | Live worker state, queue depths, heartbeat tracking                                |

The API reads events from your Celery broker through Redis pub/sub or AMQP. Events stream into ClickHouse for history and analytics, while Redis holds the live worker state. The frontend uses WebSocket for live updates and REST for historical queries.

## Configuration

All configuration is via environment variables. See [docs/configuration.md](docs/configuration.md) for the full reference.

**Required for the API server:**

| Variable         | Default                  | Description                                       |
| ---------------- | ------------------------ | ------------------------------------------------- |
| `DATABASE_URL`   | -                        | PostgreSQL connection string                      |
| `CLICKHOUSE_URL` | `http://localhost:8123`  | ClickHouse HTTP endpoint                          |
| `REDIS_URL`      | `redis://localhost:6379` | Redis connection string                           |
| `JWT_SECRET`     | -                        | Secret key for JWT signing (change in production) |
| `CORS_ORIGIN`    | `http://localhost:3000`  | Comma-separated allowed origins                   |
| `PORT`           | `8080`                   | API server port                                   |
| `ALLOW_SIGNUP`   | `false`                  | Allow public registration after initial setup     |

## Production deployment

### Kubernetes (Helm)

Install on any Kubernetes cluster (EKS, GKE, AKS, bare-metal) in a single command:

```bash
helm install feloxi oci://ghcr.io/thesaadmirza/charts/feloxi \
  --namespace feloxi --create-namespace \
  --set auth.jwtSecret="<min-32-char-secret>" \
  --set postgresql.auth.password="<pgpassword>" \
  --set clickhouse.auth.password="<chpassword>"
```

Then access the dashboard:

```bash
kubectl port-forward -n feloxi svc/feloxi-web 3000:80
# open http://localhost:3000
```

The chart bundles PostgreSQL, ClickHouse, and Redis by default. Point to your own managed instances by setting `postgresql.enabled=false` and `externalPostgresql.host=...` (same pattern for ClickHouse and Redis). See [charts/feloxi/README.md](charts/feloxi/README.md) for the full values reference, ingress setup, and `existingSecret` pattern for production credentials.

### Docker Compose

For production, use the production compose overrides:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Checklist:

- Set a strong `JWT_SECRET` (at least 32 random characters)
- Configure `CORS_ORIGIN` to your frontend domain
- Use managed PostgreSQL and Redis for persistence and HA
- Place behind a reverse proxy (nginx/Caddy) with TLS
- Set `RUST_LOG=api=warn,tower_http=warn` to reduce log volume

See [docs/self-hosting.md](docs/self-hosting.md) for the full production guide covering nginx TLS, horizontal scaling, and resource sizing.

## Tech stack

| Layer          | Technology                                                              |
| -------------- | ----------------------------------------------------------------------- |
| API Server     | Rust, Axum, Tokio, SQLx, Tower                                          |
| Event Store    | ClickHouse with SummingMergeTree materialized views                     |
| Auth           | JWT (HS256) with HttpOnly refresh tokens, Argon2 passwords, RBAC        |
| Frontend       | Next.js 15, React 19, Tailwind CSS v4, Recharts, Zustand                |
| Protocol       | WebSocket with JSON messages, auto-reconnect                            |
| Alerting       | Slack, Email (SMTP via lettre), Webhook, PagerDuty                      |
| Infrastructure | Docker Compose, Kubernetes (Helm chart), PostgreSQL 17, Redis 7, ClickHouse 24.12 |

## Documentation

| Document                               | Description                                    |
| -------------------------------------- | ---------------------------------------------- |
| [Architecture](docs/architecture.md)   | System design, data flow, Rust crate structure |
| [Configuration](docs/configuration.md) | All environment variables and defaults         |
| [Self-Hosting](docs/self-hosting.md)   | Production deployment guide                    |
| [Sizing](docs/sizing.md)               | Resource planning from <100K to 10M+ tasks/day |
| [Helm Chart](charts/feloxi/README.md)  | Kubernetes deployment, values reference, ingress, external DBs |

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, code style, and PR guidelines.

Issues labeled **good first issue** are a decent place to start.

## Acknowledgments

Feloxi was inspired by [Flower](https://github.com/mher/flower), the original Celery monitoring tool by [Mher Movsisyan](https://github.com/mher). Flower pioneered browser-based Celery monitoring. Feloxi extends the idea with persistent storage, time-series analytics, and alerting for teams running Celery at scale.

## License

Apache 2.0. See [LICENSE](LICENSE) for details.
