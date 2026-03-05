# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-03-04

### Added

#### Core Platform
- Celery task queue monitoring with persistent storage (ClickHouse)
- Real-time WebSocket dashboard with live task and worker event streaming
- Multi-tenant architecture with tenant isolation across all data stores
- Role-based access control (RBAC) with 4 system roles and 14 granular permissions
- JWT authentication with HttpOnly cookie transport and single-use refresh token rotation
- First-run setup wizard for creating the initial admin account and organization
- `ALLOW_SIGNUP` env var to control public registration (default: disabled)
- API key authentication for programmatic access
- OpenAPI 3.1 specification with Swagger UI at `/docs`

#### Broker Integration
- Direct broker connection — no agent or SDK required
- Redis broker consumer (pub/sub event subscription)
- RabbitMQ / AMQP broker consumer
- Multi-broker support from a single Feloxi instance
- Broker connection management with start/stop/test controls
- Task retry and revoke via direct broker commands
- Queue depth monitoring

#### Task Monitoring
- Full task lifecycle tracking (PENDING → STARTED → SUCCESS/FAILURE/RETRY/REVOKED)
- Task explorer with search and filtering by state/name/queue
- Task detail view with args, kwargs, result, exception, traceback, runtime, retries
- Task event timeline showing state transitions
- Task hierarchy tracking (root_id, parent_id, group_id)

#### Worker Monitoring
- Worker online/offline detection via heartbeat events
- Per-worker resource metrics: CPU%, memory, load averages, pool info
- Active task count and processed task count per worker
- Worker shutdown command via broker pidbox
- Real-time worker state in Redis with automatic TTL expiry

#### Analytics & Metrics
- Throughput charts (success/failure over time) powered by ClickHouse materialized views
- Failure rate tracking with configurable time ranges (1h/6h/24h/7d)
- Per-task-name and per-queue breakdown
- Overview metrics: total tasks, success rate, failure rate, avg runtime, p95 runtime
- Per-broker ingestion statistics

#### Alerting
- 10 alert condition types (failure rate, task duration, queue depth, worker offline, and more)
- Webhook notifications with full payload logging
- Email notifications via configurable SMTP
- Slack and PagerDuty notification channels
- Per-rule cooldown throttling to prevent alert storms
- Anti-flap controls: failure tolerance and grace periods
- Alert history with per-channel delivery tracking

#### Frontend
- Next.js 15 App Router with React 19
- Dark and light theme with CSS-variable-based toggle
- Recharts-powered interactive charts
- Zustand WebSocket store for zero-latency live updates
- Type-safe API client auto-generated from OpenAPI spec
- Responsive layout with collapsible sidebar

#### Infrastructure
- Docker Compose deployment with 6 services (API, web, PostgreSQL, ClickHouse, Redis, seed)
- Demo data seeder with 50,000 task events and 5,000 worker events
- Configurable data retention policies with TTL enforcement
- Production deployment guide with nginx TLS configuration
- Resource sizing guide from small (<100K tasks/day) to XL (10M+)

### Infrastructure Details

| Component | Technology |
|-----------|-----------|
| API Server | Rust (Axum, Tokio) |
| Frontend | Next.js 15, React 19, Tailwind CSS v4 |
| Config & Auth DB | PostgreSQL 17 |
| Event Storage | ClickHouse 24.12 |
| Real-time State | Redis 7 |
| License | Apache-2.0 |
