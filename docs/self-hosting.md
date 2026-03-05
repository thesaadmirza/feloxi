# Self-Hosting Guide

Run Feloxi on your own infrastructure using Docker Compose. Your data stays on your servers.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 24+ with Compose V2
- 2 GB RAM minimum (4 GB recommended)
- 10 GB disk space

## Quick Start

```bash
git clone https://github.com/feloxi/feloxi.git
cd feloxi
cp .env.example .env
docker compose up -d
```

This starts 6 services:

| Service             | Image                                | Port | Purpose                      |
| ------------------- | ------------------------------------ | ---- | ---------------------------- |
| `feloxi-api`        | Built from `Dockerfile.api`          | 8080 | Rust API server              |
| `feloxi-web`        | Built from `Dockerfile.web`          | 3000 | Next.js frontend             |
| `feloxi-postgres`   | `postgres:17-bookworm`               | —    | Auth and configuration       |
| `feloxi-clickhouse` | `clickhouse/clickhouse-server:24.12` | —    | Event storage                |
| `feloxi-redis`      | `redis:7-alpine`                     | —    | Real-time state              |
| `feloxi-seed`       | Built from `Dockerfile.seed`         | —    | Demo data seeder (runs once) |

The seed container populates the database with a demo tenant, 50,000 task events, 5,000 worker events, and simulated worker state. It's idempotent — running `docker compose up` again won't re-seed if data already exists.

## Verify Installation

1. Open **http://localhost:3000**
2. Sign in with the demo credentials:

| Field        | Value             |
| ------------ | ----------------- |
| Email        | `demo@feloxi.dev` |
| Password     | `password123`     |
| Organization | `demo-corp`       |

3. Check the health endpoint: `curl http://localhost:8080/api/v1/healthz`

## Connecting Your Celery Broker

Feloxi monitors Celery by connecting to the same message broker your workers use. No agent binary or SDK is required — the API server consumes events directly from the broker.

### Step 1: Enable Celery Events

Your Celery workers must publish events. Start workers with the `--events` flag:

```bash
celery -A myapp worker --loglevel=info --events
```

Or enable at runtime on already-running workers:

```bash
celery -A myapp control enable_events
```

### Step 2: Add the Broker in the Dashboard

1. Navigate to **Brokers** in the sidebar
2. Click **Add Broker**
3. Choose **Redis** or **RabbitMQ**
4. Enter the connection URL (the same URL your Celery workers connect to)
5. Click **Test** to verify the connection
6. Click **Connect & Start Monitoring**

You can also add brokers via the API:

```bash
curl -X POST http://localhost:8080/api/v1/brokers \
  -H "Content-Type: application/json" \
  -b "fp_access=YOUR_TOKEN" \
  -d '{
    "name": "Production Redis",
    "broker_type": "redis",
    "connection_url": "redis://your-redis:6379/0"
  }'
```

### Step 3: Verify Events

After connecting, go to the **Dashboard**. You should see task throughput and worker status within seconds of your workers processing tasks.

## Environment Variables

See [configuration.md](configuration.md) for the full reference. The essential production variables:

| Variable         | Production Value                                   |
| ---------------- | -------------------------------------------------- |
| `JWT_SECRET`     | A strong random string, at least 32 characters     |
| `CORS_ORIGIN`    | Your frontend domain: `https://feloxi.example.com` |
| `DATABASE_URL`   | Your managed PostgreSQL instance                   |
| `CLICKHOUSE_URL` | Your ClickHouse instance                           |
| `REDIS_URL`      | Your managed Redis instance                        |
| `RUST_LOG`       | `api=warn,tower_http=warn`                      |

## Production Deployment

For production, use the production overrides:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Checklist

- [ ] Set a strong `JWT_SECRET` (generate with `openssl rand -hex 32`)
- [ ] Configure `CORS_ORIGIN` to your actual frontend domain
- [ ] Use managed PostgreSQL with backups enabled
- [ ] Use managed Redis with persistence (AOF or RDB)
- [ ] Place behind a reverse proxy (nginx, Caddy, or cloud LB) with TLS
- [ ] Set `RUST_LOG=api=warn,tower_http=warn` to reduce log volume
- [ ] Configure data retention policies in **Settings > Retention**

### TLS / Reverse Proxy

Feloxi does not terminate TLS itself. Use a reverse proxy:

**nginx example:**

```nginx
server {
    listen 443 ssl;
    server_name feloxi.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Frontend
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket
    location /ws/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### Horizontal Scaling

The API server is stateless and can be scaled horizontally behind a load balancer. Sticky sessions are not required for REST, but WebSocket connections should be load-balanced with session affinity.

All three databases (PostgreSQL, ClickHouse, Redis) can be replaced with managed or clustered equivalents. The API accepts standard connection strings.

## Re-seeding Demo Data

To start fresh with new demo data:

```bash
docker compose down -v     # Remove all volumes (destroys data)
docker compose up -d       # Recreate with fresh seed
```

## Upgrading

Pull the latest changes and rebuild:

```bash
git pull
docker compose build
docker compose up -d
```

Database migrations are applied automatically on startup. ClickHouse tables use `IF NOT EXISTS` so they're safe to re-run.
