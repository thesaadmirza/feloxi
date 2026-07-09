# Configuration

All Feloxi configuration is done through environment variables. Copy `.env.example` to `.env` and customize as needed.

## API Server

| Variable         | Required | Default                       | Description                                                                                                                           |
| ---------------- | -------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`   | Yes      | —                             | PostgreSQL connection string. Example: `postgres://fp:feloxi@localhost:5432/feloxi`                                                   |
| `CLICKHOUSE_URL` | Yes      | `http://localhost:8123`       | ClickHouse HTTP endpoint                                                                                                              |
| `REDIS_URL`      | Yes      | `redis://localhost:6379`      | Redis connection string                                                                                                               |
| `JWT_SECRET`     | Yes      | —                             | Secret key for signing JWT tokens. Use at least 32 random characters in production                                                    |
| `ENCRYPTION_KEY` | Yes      | —                             | Base64-encoded 32-byte key that encrypts integration tokens and the SMTP password at rest. Generate with `openssl rand -base64 32`. The API refuses to start without it. Losing it makes stored secrets unrecoverable — back it up alongside `JWT_SECRET`. |
| `CORS_ORIGIN`    | No       | `http://localhost:3000`       | Comma-separated list of allowed origins                                                                                               |
| `APP_BASE_URL`   | No       | first `CORS_ORIGIN`, else `http://localhost:3000` | Public URL where people reach Feloxi. Used to build OAuth redirect URLs (e.g. the Slack callback). Set this when running behind a domain or reverse proxy.            |
| `PORT`           | No       | `8080`                        | Port the API server listens on                                                                                                        |
| `RUST_LOG`       | No       | `api=info,tower_http=info` | Log level filter ([tracing filter syntax](https://docs.rs/tracing-subscriber/latest/tracing_subscriber/filter/struct.EnvFilter.html)) |
| `ALLOW_SIGNUP`   | No       | `false`                       | Allow public registration. When `false`, only the setup wizard (first user) and admin invites work                                    |
| `CLICKHOUSE_USER` | No     | —                             | ClickHouse username (if auth is enabled)                                                                                              |
| `CLICKHOUSE_PASSWORD` | No | —                             | ClickHouse password (if auth is enabled)                                                                                              |
| `DISABLE_SWAGGER` | No     | `false`                       | Set to `true` to disable Swagger UI in production                                                                                     |
| `DISABLE_PROMETHEUS` | No  | `false`                       | Set to `true` to disable the `GET /metrics` Prometheus scrape endpoint                                                                |

## Frontend

| Variable  | Required | Default                 | Description                                                                 |
| --------- | -------- | ----------------------- | --------------------------------------------------------------------------- |
| `API_URL` | No       | `http://localhost:8080` | Backend API URL (server-side only, proxied via Next.js rewrites)            |

> **Note:** The frontend uses Next.js rewrites to proxy `/api/*` and `/ws/*` requests to the backend. `API_URL` is a server-side env var read at runtime — it is **not** baked into the client JS bundle. This means pre-built Docker images work in any environment without rebuilding.

## OAuth integrations and SSO (optional)

These enable one-click connect flows (Slack, Discord) and "Sign in with Google". Each provider is independent: leave its variables unset and the corresponding button never appears. Notification channels always fall back to webhook paste, which needs no setup. See [integrations.md](integrations.md) for the full walkthroughs.

| Variable               | Required | Default               | Description                                                                                        |
| ---------------------- | -------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| `SLACK_CLIENT_ID`      | No       | —                     | Client ID of the Slack app you register. The "Connect Slack" button appears only when this is set  |
| `SLACK_CLIENT_SECRET`  | No       | —                     | Client secret of that Slack app. Store it as a secret, never in the repo                            |
| `SLACK_API_BASE_URL`   | No       | `https://slack.com`   | Override the Slack API base — for an egress proxy or a mock Slack in tests. Leave unset normally    |
| `DISCORD_CLIENT_ID`    | No       | —                     | Client ID of the Discord application. Enables "Connect Discord" (incoming-webhook consent flow)     |
| `DISCORD_CLIENT_SECRET`| No       | —                     | Client secret of that Discord application                                                           |
| `DISCORD_API_BASE_URL` | No       | `https://discord.com` | Override the Discord base URL — for proxies or tests. Leave unset normally                          |
| `GOOGLE_CLIENT_ID`     | No       | —                     | OAuth client ID from Google Cloud Console. Enables "Sign in with Google" on the login page          |
| `GOOGLE_CLIENT_SECRET` | No       | —                     | Client secret of that OAuth client                                                                  |

Redirect URLs to register with each provider (also shown in the app):

- Slack: `${APP_BASE_URL}/api/v1/integrations/slack/callback` (shown in **Settings → Notifications**)
- Discord: `${APP_BASE_URL}/api/v1/integrations/discord/callback` (shown in **Settings → Notifications**)
- Google: `${APP_BASE_URL}/api/v1/auth/google/callback`

Google SSO signs in existing users by their verified Google email — it never creates accounts, so `ALLOW_SIGNUP=false` stays enforced.

## Example `.env`

```bash
# Feloxi Configuration
# All values below work out of the box with `docker compose up`.

# API Server
PORT=8080
DATABASE_URL=postgres://fp:feloxi@localhost:5432/feloxi
CLICKHOUSE_URL=http://localhost:8123
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-this-to-a-secure-secret-in-production
ENCRYPTION_KEY=  # required — run: openssl rand -base64 32
CORS_ORIGIN=http://localhost:3000,http://127.0.0.1:3000
RUST_LOG=api=info,tower_http=info
ALLOW_SIGNUP=false

# Frontend
API_URL=http://localhost:8080
```

## Docker Compose Defaults

When using `docker compose up`, the services use internal Docker networking. The defaults in `docker-compose.yml`:

| Variable              | Value                                         |
| --------------------- | --------------------------------------------- |
| `DATABASE_URL`        | `postgresql://fp:feloxi@postgres:5432/feloxi` |
| `CLICKHOUSE_URL`      | `http://clickhouse:8123`                      |
| `REDIS_URL`           | `redis://redis:6379`                          |
| `JWT_SECRET`          | `dev-secret-change-in-production-1234567890`  |
| `CORS_ORIGIN`         | `http://localhost:3000,http://127.0.0.1:3000` |
| `API_URL`             | `http://api:8080`                             |

> **Warning:** The default `JWT_SECRET` is for development only. Always generate a strong, unique secret for production.

## CORS

The `CORS_ORIGIN` variable accepts a comma-separated list:

```bash
# Single origin
CORS_ORIGIN=https://feloxi.example.com

# Multiple origins
CORS_ORIGIN=https://feloxi.example.com,https://staging.feloxi.example.com
```

The API allows `GET`, `POST`, `PUT`, `DELETE`, and `OPTIONS` methods with `Content-Type`, `Authorization`, and `Accept` headers. Credentials (cookies) are included.

## Performance Tuning

Optional environment variables for high-throughput deployments. Defaults work well for most setups.

| Variable                      | Default  | Description                                                                 |
| ----------------------------- | -------- | --------------------------------------------------------------------------- |
| `FP_PG_MAX_CONNECTIONS`       | `50`     | Maximum PostgreSQL pool connections                                         |
| `FP_REDIS_POOL_SIZE`          | `50`     | Redis connection pool size                                                  |
| `FP_PUBSUB_CHANNEL_CAPACITY`  | `10000`  | Internal buffer for Redis PubSub messages from Celery brokers. Increase if you see "PubSub receiver lagged" warnings at high event rates (1000+ events/sec) |
| `FP_FLUSH_INTERVAL_SECS`     | `1`      | How often the consumer flushes batched events to ClickHouse                 |
| `FP_DRAIN_INTERVAL_SECS`     | `30`     | How often the consumer drains list-based Celery queues                      |
| `FP_DRAIN_MAX_MESSAGES`       | `500`    | Maximum messages to drain from list queues per cycle                        |
| `FP_STATS_INTERVAL_SECS`     | `30`     | How often consumer throughput stats are logged                              |
| `FP_TASK_BATCH_SIZE`          | `100`    | Task event batch threshold before early flush                               |
| `FP_WORKER_BATCH_SIZE`        | `20`     | Worker event batch threshold before early flush                             |

## Logging

API server logs are output in **JSON format** for structured log aggregation. Control verbosity with `RUST_LOG`:

```bash
# Development (verbose)
RUST_LOG=api=debug,tower_http=debug

# Production (minimal)
RUST_LOG=api=warn,tower_http=warn

# Debug specific subsystems
RUST_LOG=api=info,alerting=debug,db=debug,engine=trace
```
