# Architecture

Feloxi is a Celery task queue monitoring platform. The API server connects directly to your message broker (Redis or RabbitMQ) to consume Celery events, stores them in ClickHouse for analytics, and serves a real-time Next.js dashboard over WebSocket.

## System Overview

```
Celery Workers ──publish events──▶ Broker (Redis / RabbitMQ)
                                          │
                                    ┌─────┴─────┐
                                    │  Feloxi   │
                                    │  API      │ :8080
                                    │  (Rust)   │
                                    └──┬──┬──┬──┘
                                       │  │  │
                              ┌────────┘  │  └────────┐
                              ▼           ▼           ▼
                        ┌──────────┐┌──────────┐┌──────────┐
                        │PostgreSQL││ClickHouse││  Redis   │
                        │Config &  ││  Events  ││Real-time │
                        │  Auth    ││& Metrics ││  State   │
                        └──────────┘└──────────┘└──────────┘
                                          │
                                    ┌─────┴─────┐
                                    │  Next.js  │ :3000
                                    │  Frontend │
                                    └───────────┘
```

## Data Flow

1. **Celery workers** publish task and worker events to the message broker (requires the `--events` flag or `celery control enable_events`)
2. **Feloxi API** runs a broker consumer (Redis pub/sub or AMQP) that subscribes to Celery event channels
3. Events are **normalized** by `engine` (maps Celery event types to states: `task-succeeded` → `SUCCESS`, `task-failed` → `FAILURE`, etc.)
4. Normalized events are **written to ClickHouse** in batches for history and analytics
5. **Redis** is updated with live worker state (heartbeats, online status, queue depths)
6. The **WebSocket endpoint** (`/ws/dashboard`) broadcasts events to connected frontends in real-time
7. The **Next.js frontend** renders dashboards using WebSocket for live data and REST for historical queries

## Components

| Component | Technology | Port | Role |
|-----------|-----------|------|------|
| API Server | Rust (Axum, Tokio) | 8080 | HTTP API, WebSocket server, broker consumers, alert scheduler, retention enforcement |
| Frontend | Next.js 15, React 19 | 3000 | Dashboard, task explorer, worker monitoring, broker management, settings |
| PostgreSQL | PostgreSQL 17 | 5432 | Users, tenants, roles, broker configs, alert rules, API keys, refresh tokens, retention policies |
| ClickHouse | ClickHouse 24.12 | 8123 | Task events, worker events, materialized views for metrics aggregation |
| Redis | Redis 7 | 6379 | Live worker state, queue depths, beat schedules, heartbeat tracking |

## Database Responsibilities

### PostgreSQL (configuration and auth)
- Tenant and user management with RBAC (4 system roles, 14 permissions)
- JWT refresh token storage (SHA-256 hashed, single-use rotation, 30-day TTL)
- Broker connection configs (encrypted connection URLs)
- Alert rule definitions and firing history
- API key storage (prefix + hash)
- Data retention policy settings

### ClickHouse (event storage and analytics)
- **`task_events`**: Every task state transition with full metadata (args, kwargs, result, exception, traceback, runtime, retries, root_id, parent_id, group_id). Partitioned by `(tenant_id, toYYYYMM(timestamp))`, 90-day TTL.
- **`worker_events`**: Heartbeats, online/offline events with CPU, memory, load averages, pool info. 30-day TTL.
- **`task_metrics_mv`**: SummingMergeTree materialized view with per-minute success/failure/retry/revoked counts by task name and queue. Powers the throughput dashboard.
- **`queue_metrics_mv`**: SummingMergeTree materialized view with per-minute enqueue/dequeue/complete/fail counts by queue.

### Redis (real-time state)
All keys are prefixed with `fp:{tenant_id}:` for multi-tenant isolation.

| Key Pattern | Type | TTL | Purpose |
|-------------|------|-----|---------|
| `fp:{tid}:worker:{wid}:state` | String (JSON) | 300-600s | Live worker state blob |
| `fp:{tid}:worker:{wid}:heartbeat` | String | 600s | Last heartbeat timestamp |
| `fp:{tid}:workers:online` | Set | — | Currently online worker IDs |
| `fp:{tid}:queue:{name}:depth` | String | 600s | Current queue message count |
| `fp:{tid}:queues:active` | Set | — | Active queue names |
| `fp:{tid}:beat:schedule` | Hash | — | Beat schedule definitions |

## Rust Crate Structure

The backend is a Cargo workspace with 6 crates:

| Crate | Type | Description |
|-------|------|-------------|
| `api` | Binary | Axum HTTP server, route handlers, broker connection manager, WebSocket endpoint (`/ws/dashboard`), alert evaluation scheduler, retention enforcement loop |
| `engine` | Library | Event normalization (Celery event types → task states), metrics computation, DAG resolution for task workflows, beat monitoring, worker/task state management |
| `auth` | Library | JWT creation/validation (HS256, 15min TTL), RBAC permission checking, refresh token rotation (SHA-256, 30-day TTL), HttpOnly cookie management |
| `db` | Library | Database access layer — SQLx for PostgreSQL, `clickhouse` crate for ClickHouse (RowBinary protocol), `fred` for Redis |
| `alerting` | Library | 10 alert condition types, notification dispatch to 4 channels (Slack, email via lettre, webhook, PagerDuty), per-rule cooldown throttling |
| `common` | Library | Shared types (AppError, BrokerType, CollectorType), error handling helpers, utility functions |

## API Startup Sequence

1. Load configuration from environment variables
2. Initialize connection pools (PostgreSQL, ClickHouse, Redis)
3. Create broadcast channel (capacity 100,000) for tenant event distribution
4. Auto-start broker consumers for all active broker configs in PostgreSQL
5. Spawn background tasks: alert evaluation (every 60s), retention enforcement (every 1h)
6. Register middleware stack: CORS, request tracing (JSON logs), compression
7. Mount routes with JWT auth middleware on protected endpoints
8. Listen on configured port with graceful shutdown on SIGINT

## Authentication

- **JWT access tokens**: HS256, 15-minute TTL. Accepted via `Authorization: Bearer <token>` header or `fp_access` HttpOnly cookie.
- **Refresh tokens**: Format `fp_rt_{uuid}`, SHA-256 hashed in PostgreSQL, 30-day TTL, single-use rotation. Sent via `fp_refresh` HttpOnly cookie (path-restricted to `/api/v1/auth`).
- **RBAC**: 4 system roles (admin, editor, viewer, readonly) across 14 granular permissions. Admin role bypasses all permission checks.

## Frontend Architecture

- **Next.js 15** App Router with `(dashboard)` route group (all pages share sidebar + header layout)
- **Zustand** WebSocket store for live data (task updates, worker state changes, alert firings, metrics summaries)
- **openapi-fetch** client auto-generated from the API's OpenAPI spec via `utoipa` + `openapi-typescript`
- **React Query** for REST data fetching with configurable polling intervals and cache invalidation
- **Recharts** for throughput, failure rate, and queue metrics charts
- **Tailwind CSS v4** with CSS-variable-based dark/light theme toggled via `next-themes`
