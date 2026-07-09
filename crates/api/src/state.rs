use std::sync::Arc;

use fred::prelude::Pool;
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

use auth::jwt::JwtKeys;
use common::crypto::Encryptor;

use crate::broker_conn::manager::BrokerConnectionManager;

/// Cached system health response with TTL.
pub struct HealthCache {
    inner: RwLock<Option<(tokio::time::Instant, serde_json::Value)>>,
    ttl: std::time::Duration,
}

impl HealthCache {
    pub fn new(ttl: std::time::Duration) -> Self {
        Self { inner: RwLock::new(None), ttl }
    }

    /// Get cached value if still fresh.
    pub async fn get(&self) -> Option<serde_json::Value> {
        let guard = self.inner.read().await;
        guard.as_ref().filter(|(ts, _)| ts.elapsed() < self.ttl).map(|(_, v)| v.clone())
    }

    /// Store a new cached value.
    pub async fn set(&self, value: serde_json::Value) {
        let mut guard = self.inner.write().await;
        *guard = Some((tokio::time::Instant::now(), value));
    }
}

/// Application-wide shared state.
#[derive(Clone)]
pub struct AppState {
    pub pg: sqlx::PgPool,
    pub ch: clickhouse::Client,
    pub redis: Pool,
    pub event_tx: broadcast::Sender<TenantEvent>,
    pub broker_manager: Arc<BrokerConnectionManager>,
    pub config: Arc<AppConfig>,
    pub jwt_keys: Arc<JwtKeys>,
    pub health_cache: Arc<HealthCache>,
    /// Encrypts/decrypts secrets at rest (integration tokens, SMTP password).
    pub encryptor: Arc<Encryptor>,
    /// Shared outbound HTTP client (connection pool reused across OAuth,
    /// integration tests, and the alert-delivery hot path).
    pub http: reqwest::Client,
}

/// A tenant-scoped event for broadcasting.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantEvent {
    pub tenant_id: Uuid,
    pub payload: EventPayload,
}

/// Event payload variants.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum EventPayload {
    TaskUpdate {
        task_id: String,
        task_name: String,
        state: String,
        queue: String,
        worker_id: String,
        runtime: Option<f64>,
        timestamp: f64,
    },
    WorkerUpdate {
        worker_id: String,
        hostname: String,
        status: String,
        active_tasks: u32,
        cpu_percent: f64,
        memory_mb: f64,
    },
    BeatUpdate {
        schedule_name: String,
        task_name: String,
        last_run_at: Option<f64>,
        next_run_at: Option<f64>,
    },
    AlertFired {
        rule_id: Uuid,
        rule_name: String,
        severity: String,
        summary: String,
    },
    AlertResolved {
        rule_id: Uuid,
        rule_name: String,
        summary: String,
    },
    MetricsSummary {
        throughput: f64,
        failure_rate: f64,
        active_workers: u64,
        queue_depth: u64,
    },
}

/// Application configuration.
#[derive(Debug, Clone)]
pub struct AppConfig {
    pub port: u16,
    pub database_url: String,
    pub clickhouse_url: String,
    pub clickhouse_user: Option<String>,
    pub clickhouse_password: Option<String>,
    pub redis_url: String,
    pub jwt_secret: String,
    pub cors_origin: String,
    pub allow_signup: bool,
    /// Public base URL of the web app (e.g. "https://feloxi.staging.fleetit.com").
    /// Used to build invite links and OAuth redirect URLs. Falls back to the
    /// first CORS origin if unset.
    pub app_base_url: String,
    /// System-level SMTP config for auth emails (magic link, invites). Separate
    /// from per-tenant SMTP which is used for alerts. `None` if `SMTP_HOST` is
    /// unset — in that case magic-link requests return 503.
    pub system_smtp: Option<alerting::channels::email::SmtpConfig>,
    /// OAuth client credentials for connect/SSO flows. Each provider is `None`
    /// when its `*_CLIENT_ID`/`*_CLIENT_SECRET` env vars are unset, in which
    /// case the corresponding "Connect"/SSO buttons are hidden (the
    /// webhook-paste path remains the default).
    pub oauth: OAuthConfig,
    /// Base URL for the Slack API + OAuth (default `https://slack.com`).
    /// Overridable via `SLACK_API_BASE_URL` for self-hosted proxies or tests.
    pub slack_api_base: String,
}

/// OAuth client credentials, one per provider.
#[derive(Clone, Default)]
pub struct OAuthConfig {
    pub slack: Option<OAuthClient>,
    pub discord: Option<OAuthClient>,
    pub google: Option<OAuthClient>,
}

#[derive(Clone)]
pub struct OAuthClient {
    pub client_id: String,
    pub client_secret: String,
}

impl std::fmt::Debug for OAuthClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Redact the secret; the client_id is not sensitive.
        f.debug_struct("OAuthClient").field("client_id", &self.client_id).finish_non_exhaustive()
    }
}

impl std::fmt::Debug for OAuthConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OAuthConfig")
            .field("slack", &self.slack.is_some())
            .field("discord", &self.discord.is_some())
            .field("google", &self.google.is_some())
            .finish()
    }
}

/// Load an OAuth client from `{PREFIX}_CLIENT_ID` / `{PREFIX}_CLIENT_SECRET`.
/// Returns `None` unless both are set and non-empty.
fn load_oauth_client(prefix: &str) -> Option<OAuthClient> {
    let id = std::env::var(format!("{prefix}_CLIENT_ID")).ok().filter(|s| !s.is_empty())?;
    let secret = std::env::var(format!("{prefix}_CLIENT_SECRET")).ok().filter(|s| !s.is_empty())?;
    Some(OAuthClient { client_id: id, client_secret: secret })
}

impl AppConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            port: std::env::var("PORT").unwrap_or_else(|_| "8080".into()).parse()?,
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://fp:fp@localhost:5432/feloxi".into()),
            clickhouse_url: std::env::var("CLICKHOUSE_URL")
                .unwrap_or_else(|_| "http://localhost:8123".into()),
            clickhouse_user: std::env::var("CLICKHOUSE_USER").ok(),
            clickhouse_password: std::env::var("CLICKHOUSE_PASSWORD").ok(),
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".into()),
            jwt_secret: {
                let secret = std::env::var("JWT_SECRET")
                    .expect("JWT_SECRET must be set (min 32 characters)");
                assert!(secret.len() >= 32, "JWT_SECRET must be at least 32 characters");
                secret
            },
            cors_origin: std::env::var("CORS_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:3000".into()),
            allow_signup: std::env::var("ALLOW_SIGNUP")
                .unwrap_or_else(|_| "false".into())
                .parse()
                .unwrap_or(false),
            app_base_url: std::env::var("APP_BASE_URL").unwrap_or_else(|_| {
                std::env::var("CORS_ORIGIN")
                    .ok()
                    .and_then(|v| v.split(',').next().map(|s| s.trim().to_string()))
                    .unwrap_or_else(|| "http://localhost:3000".into())
            }),
            system_smtp: load_system_smtp(),
            oauth: OAuthConfig {
                slack: load_oauth_client("SLACK"),
                discord: load_oauth_client("DISCORD"),
                google: load_oauth_client("GOOGLE"),
            },
            slack_api_base: std::env::var("SLACK_API_BASE_URL")
                .ok()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "https://slack.com".into())
                .trim_end_matches('/')
                .to_string(),
        })
    }
}

/// Load the secrets-at-rest encryptor from `ENCRYPTION_KEY` (base64, 32 bytes).
///
/// Required — like `JWT_SECRET` — because losing or omitting it makes stored
/// integration tokens and the SMTP password unusable. Generate one with
/// `openssl rand -base64 32`.
pub fn load_encryptor() -> anyhow::Result<Encryptor> {
    let key = std::env::var("ENCRYPTION_KEY").map_err(|_| {
        anyhow::anyhow!(
            "ENCRYPTION_KEY must be set (base64-encoded 32 bytes; `openssl rand -base64 32`)"
        )
    })?;
    Encryptor::from_base64(&key).map_err(|e| anyhow::anyhow!("invalid ENCRYPTION_KEY: {e}"))
}

fn load_system_smtp() -> Option<alerting::channels::email::SmtpConfig> {
    let host = std::env::var("SMTP_HOST").ok()?;
    if host.is_empty() {
        return None;
    }
    Some(alerting::channels::email::SmtpConfig {
        host,
        port: std::env::var("SMTP_PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(587),
        username: std::env::var("SMTP_USERNAME").unwrap_or_default(),
        password: std::env::var("SMTP_PASSWORD").unwrap_or_default(),
        from_address: std::env::var("SMTP_FROM").unwrap_or_else(|_| "noreply@feloxi.dev".into()),
        tls: std::env::var("SMTP_TLS").map(|v| v != "false").unwrap_or(true),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_payload_type_tags_all_variants() {
        let payloads: Vec<(EventPayload, &str)> = vec![
            (
                EventPayload::TaskUpdate {
                    task_id: "t".into(),
                    task_name: "n".into(),
                    state: "PENDING".into(),
                    queue: "q".into(),
                    worker_id: "w".into(),
                    runtime: None,
                    timestamp: 0.0,
                },
                "TaskUpdate",
            ),
            (
                EventPayload::WorkerUpdate {
                    worker_id: "w".into(),
                    hostname: "h".into(),
                    status: "online".into(),
                    active_tasks: 0,
                    cpu_percent: 0.0,
                    memory_mb: 0.0,
                },
                "WorkerUpdate",
            ),
            (
                EventPayload::BeatUpdate {
                    schedule_name: "s".into(),
                    task_name: "t".into(),
                    last_run_at: None,
                    next_run_at: None,
                },
                "BeatUpdate",
            ),
            (
                EventPayload::AlertFired {
                    rule_id: Uuid::nil(),
                    rule_name: "r".into(),
                    severity: "warn".into(),
                    summary: "s".into(),
                },
                "AlertFired",
            ),
            (
                EventPayload::MetricsSummary {
                    throughput: 0.0,
                    failure_rate: 0.0,
                    active_workers: 0,
                    queue_depth: 0,
                },
                "MetricsSummary",
            ),
        ];
        for (payload, expected_tag) in &payloads {
            let json = serde_json::to_value(payload).unwrap();
            assert_eq!(json["type"], *expected_tag);
        }
    }

    #[test]
    fn event_payload_roundtrip_and_unknown_type_rejected() {
        let event = TenantEvent {
            tenant_id: Uuid::nil(),
            payload: EventPayload::TaskUpdate {
                task_id: "abc-123".into(),
                task_name: "tasks.add".into(),
                state: "SUCCESS".into(),
                queue: "default".into(),
                worker_id: "worker-1".into(),
                runtime: Some(1.5),
                timestamp: 1700000000.0,
            },
        };
        let json = serde_json::to_string(&event).unwrap();
        let de: TenantEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(de.tenant_id, Uuid::nil());

        let none_payload = EventPayload::TaskUpdate {
            task_id: "t".into(),
            task_name: "n".into(),
            state: "PENDING".into(),
            queue: "q".into(),
            worker_id: "w".into(),
            runtime: None,
            timestamp: 0.0,
        };
        assert!(serde_json::to_value(&none_payload).unwrap()["runtime"].is_null());

        let bad = r#"{"type": "UnknownVariant", "data": 42}"#;
        assert!(serde_json::from_str::<EventPayload>(bad).is_err());
    }
}
