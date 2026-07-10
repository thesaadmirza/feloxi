# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.1] — 2026-07-10

### Fixed

- Broker event consumers restart themselves. A consumer that failed to connect at boot (broker briefly unreachable while pods come up) or whose event stream closed mid-run stayed dead — and the broker status stuck on `error` — until a manual restart. The connection manager now supervises consumers with 5s–60s backoff.
- The queues page shows live depths for any broker instead of blanking unless the event consumer reported `connected`. Live depths come from a direct broker connection and never depended on the consumer; a not-connected consumer now renders as a warning banner (with the last error) above the data.

## [2.0.0] — 2026-07-09

The alerting release. Every advertised alert condition now actually evaluates, alerts resolve instead of spamming, and notifications can be silenced and routed by severity. Plus Discord, Google sign-in, and a batch of dashboard fixes.

### Added

- Resolved notifications: when a firing condition clears (two consecutive clean evaluations, so a metric hovering at its threshold doesn't ping-pong), the same channels get a green "resolved" notice with the firing duration. `alert_history.resolved_at` is finally set, and history shows open vs resolved incidents.
- Delivery retries: transient channel failures (network errors, 5xx, 429) retry with 60s/5m/15m backoff, honoring the provider's `Retry-After`. The delivery log records the final outcome. Permanent failures (revoked token, bad webhook) are not retried.
- Alert silences: maintenance windows scoped to one rule or all rules, with a duration and reason. Incidents still open and resolve while silenced — only notifications are held. New Silences tab on the alerts page and CRUD under `/api/v1/alerts/silences`.
- Severity routing: rules can override their derived severity (`info`/`warning`/`critical`), and each notification channel takes an optional severity floor — one rule can send warnings to Slack and reserve PagerDuty for critical. Resolve notices follow the incident's fire severity through the same floors.
- Connect Discord via OAuth (`webhook.incoming` scope): pick a server and channel in Discord's own consent screen; the webhook URL is stored encrypted. Set `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` to enable. No bot joins your server.
- Sign in with Google: OIDC login for existing users, matched by verified Google email. It never creates accounts, so `ALLOW_SIGNUP=false` stays enforced. Set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` to enable.
- RabbitMQ queue depths without the management plugin: `/queues`, the depth poll, and queue-depth alerts now work on AMQP brokers via passive queue declares over event-derived queue names.
- `AlertFired` and `AlertResolved` events are broadcast over WebSocket (the subscription topic existed; nothing ever sent it).
- Workers page: filter by status (all / online only / offline only) alongside search and sort.
- Tasks list: task IDs show a copy button for the full UUID; long task names and worker IDs get tooltips.

### Changed

- **Breaking (behavior):** a persistently firing rule now notifies once when the incident opens, not once per cooldown period. Cooldown still damps flapping (a new incident right after one resolves), which is the case it was actually good at. If you relied on cooldown re-notifications as reminders, severity routing to a paging channel is the intended replacement.
- Alert rules honor their configured `window_minutes`, `percentile`, and `grace_period_seconds`. These were accepted by the API and shown in the UI but silently evaluated as 5 minutes / p95 / immediate. Rules configured with other values start behaving as written after upgrading.
- Worker-offline detection judges liveness by heartbeat expiry instead of the online set, so a crashed worker (which never sends `worker-offline`) can no longer suppress the alert indefinitely. Grace periods longer than the 90s heartbeat TTL are measured via a persistent last-seen marker.
- Two Postgres migrations (017, 018) apply automatically on startup: a partial index on open alerts, the `alert_silences` table, and nullable severity columns. No manual steps.

### Fixed

- Six of the ten alert condition types never fired: queue depth, beat missed, no events, throughput anomaly, latency anomaly, and error rate spike evaluated against zeroed metrics every 60 seconds with nothing in the logs. All six are now wired to real data (Redis queue depths, ClickHouse baselines with Poisson-floored z-scores, spike factors with clean-history floors).
- Returning to the dashboard after 15 minutes no longer lands on the login page. The token-refresh middleware skipped any `/auth/` URL — including `/auth/me`, the call that restores the session — so a valid 30-day refresh cookie was never used.
- The queue filter on the tasks page populates even when the client app doesn't set `task_send_sent_event` (only `task-sent` events carry a queue name; the filter now also uses names observed live on the broker).
- The queues page distinguishes "no broker configured", "broker not connected" (showing the broker's live status and last error), and "no queues" instead of one generic empty state.

## [1.3.1] — 2026-06-09

### Fixed

- Task-scoped alert rules (`task_failed`, `task_failure_rate`, `task_duration`) now honor their `task_name` pattern instead of firing on any task failure tenant-wide. Patterns are globs where only `*` is a wildcard (e.g. `s3handler.drivo.*`); `*` or empty stays tenant-wide.
- The Slack channel picker no longer fails with `conversations.list ratelimited` on large workspaces. Enumeration honors Slack's `Retry-After` with bounded backoff, collapses concurrent searches behind a single-flight lock, and returns a retryable 429 instead of a 500.

## [1.3.0] — 2026-06-05

### Added

- Connect Slack via OAuth: sign in once and pick a channel from a searchable list instead of pasting a webhook URL. Opt-in — set `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET` to enable it; webhook paste stays the default. See [docs/integrations.md](docs/integrations.md).
- Reusable integrations stored separately from alert rules, with secrets encrypted at rest (AES-256-GCM).
- Settings → Notifications shows the exact OAuth redirect URL to register, derived from `APP_BASE_URL`.

### Changed

- **Breaking (operators):** `ENCRYPTION_KEY` is now required. It encrypts integration tokens and the SMTP password at rest. Generate one with `openssl rand -base64 32`; the API will not start without it. Existing deployments must set it before upgrading.
- The API deployment uses the `Recreate` strategy and rejects `replicaCount > 1`, because the alert-evaluation loop is a singleton until leader election lands.

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
