# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Feloxi

Feloxi is a Celery task queue monitoring platform (alternative to Flower). Rust backend (Axum) + Next.js frontend. Celery workers publish events to a broker (Redis/RabbitMQ), the Rust API consumes them and stores data in PostgreSQL, ClickHouse, and Redis, and the Next.js dashboard displays real-time state via WebSocket.

## Build & Dev Commands

### Backend (Rust)

```bash
cargo build --workspace          # Build all crates
cargo run                        # Start API server on :8080
cargo test --workspace           # Run all tests
cargo test -p feloxi-engine      # Run tests for a single crate
cargo fmt --all -- --check       # Check formatting (max_width: 100)
cargo clippy --workspace --all-targets  # Lint (warnings = errors in CI)
```

Requires env vars: `DATABASE_URL`, `CLICKHOUSE_URL`, `REDIS_URL`, `JWT_SECRET` (min 32 chars)

Optional: `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `DISABLE_SWAGGER`, `ALLOW_SIGNUP`

### Frontend (Next.js) — run from `apps/web/`

```bash
pnpm install                     # Install deps (pnpm 9.15+ required, Node 22+)
pnpm dev                         # Dev server on :3000
pnpm build                       # Production build
pnpm lint                        # ESLint
pnpm type-check                  # TypeScript check
pnpm test                        # Vitest
pnpm test:coverage               # Coverage report
pnpm generate:api                # Regenerate API types from OpenAPI spec
```

### Docker (full stack)

```bash
cp .env.example .env
docker compose up -d             # Starts Postgres, ClickHouse, Redis, API, web, seed
# Demo login: demo@feloxi.dev / password123
```

## Architecture

### Rust Workspace (`crates/`)

Six crates with clear responsibilities:
- **api** — Axum HTTP/WebSocket server, route composition, broker connection management, background tasks (alert eval every 60s, retention every 1h). Entry: `main.rs` → `app.rs` for router. Routes: tasks, workers, brokers, alerts, metrics, workflows, beat, dashboards, settings.
- **engine** — Event normalization (task + worker), workflow DAG resolver for task chain visualization.
- **auth** — JWT (HS256, 15-min access + 30-day refresh with rotation), Argon2 password hashing, RBAC (4 roles, 14 permissions). API key auth via SHA-256 hashing.
- **db** — Database abstractions: SQLx for PostgreSQL, `clickhouse` crate for ClickHouse, `fred` for Redis.
- **alerting** — 10 alert condition types, 4 channels (Slack, email/SMTP, webhook, PagerDuty). Evaluation engine in `engine.rs`.
- **common** — Shared types, error definitions, event structures.

Shared state flows through `AppState` (Arc-wrapped) containing PgPool, ClickHouse client, Redis pool, broadcast channel (capacity 100K), broker manager, config, and JWT keys.

### Frontend (`apps/web/`)

Next.js 15 App Router with:
- `(dashboard)` route group: dashboard, tasks, workers, brokers, queues, alerts, settings
- Task detail page with workflow DAG visualization (`workflow-dag.tsx`)
- Workers page with deployment grouping, heartbeat health monitoring, per-group task stats
- **Zustand** for WebSocket real-time state with event batching (`ws-store.ts`)
- **React Query** + **openapi-fetch** for REST (types auto-generated from backend's OpenAPI spec via utoipa)
- **Radix UI** primitives, **Recharts** for visualizations, **@xyflow/react** for workflow DAGs
- Dark/light theme via `next-themes` with CSS variable swapping (Tailwind v4)

### Broker Integration

`BrokerConnectionManager` auto-starts active brokers from PostgreSQL at startup. Supports Redis pub/sub and AMQP (Kombu protocol) consumers for Celery events. Pipeline tuning configurable via `FP_*` env vars (see .env.example).

## Code Style

- **Rust**: `rustfmt.toml` (edition 2021, max_width 100), `clippy.toml` (too-many-arguments threshold: 8). Always run `cargo fmt --all` and `cargo clippy --workspace --all-targets` before pushing.
- **TypeScript**: Prettier (semi, double quotes, 100 char width, trailing commas). ESLint with Next.js core-web-vitals.
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`). PRs require DCO sign-off (`git commit -s`).

## CI

- `ci-rust.yml`: fmt check → clippy → build → test (triggers on Rust file changes)
- `ci-frontend.yml`: lint → type-check → build (triggers on web app changes)
- `release.yml`: Docker image builds on version tags → GHCR
- `security.yml`: Trivy vulnerability scan + Gitleaks secret detection (on push to main + weekly)
