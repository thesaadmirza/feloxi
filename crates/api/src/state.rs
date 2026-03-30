use std::sync::Arc;

use fred::prelude::Pool;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use uuid::Uuid;

use auth::jwt::JwtKeys;

use crate::broker_conn::manager::BrokerConnectionManager;

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
            jwt_secret: std::env::var("JWT_SECRET")
                .expect("JWT_SECRET must be set (min 32 characters)"),
            cors_origin: std::env::var("CORS_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:3000".into()),
            allow_signup: std::env::var("ALLOW_SIGNUP")
                .unwrap_or_else(|_| "false".into())
                .parse()
                .unwrap_or(false),
        })
    }
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
