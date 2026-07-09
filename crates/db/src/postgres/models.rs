use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::types::Json;
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;

// ─────────────────────────── Alert Types (shared) ───────────────────────────

/// Alert condition types.
fn default_wildcard() -> String {
    "*".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type")]
pub enum AlertCondition {
    /// Trigger when task failure rate exceeds threshold.
    #[serde(rename = "task_failure_rate")]
    TaskFailureRate {
        threshold: f64,
        window_minutes: u64,
        #[serde(default = "default_wildcard")]
        task_name: String,
    },
    /// Trigger when queue depth exceeds threshold.
    #[serde(rename = "queue_depth")]
    QueueDepth { threshold: u64, queue: String },
    /// Trigger when a worker goes offline.
    #[serde(rename = "worker_offline")]
    WorkerOffline { grace_period_seconds: u64 },
    /// Trigger when task duration exceeds threshold at given percentile.
    #[serde(rename = "task_duration")]
    TaskDuration {
        threshold_seconds: f64,
        percentile: f64,
        #[serde(default = "default_wildcard")]
        task_name: String,
    },
    /// Trigger when a beat schedule misses its expected run.
    #[serde(rename = "beat_missed")]
    BeatMissed { schedule_name: String },
    /// Trigger when a specific task name fails.
    #[serde(rename = "task_failed")]
    TaskFailed {
        #[serde(default = "default_wildcard")]
        task_name: String,
    },
    /// Trigger when no events received for a period.
    #[serde(rename = "no_events")]
    NoEvents { silence_minutes: u64 },
    /// Trigger when task throughput deviates from historical baseline (Z-score).
    #[serde(rename = "throughput_anomaly")]
    ThroughputAnomaly {
        zscore_threshold: f64,
        window_minutes: u64,
        #[serde(default = "default_wildcard")]
        task_name: String,
    },
    /// Trigger when task latency deviates from historical baseline (Z-score).
    #[serde(rename = "latency_anomaly")]
    LatencyAnomaly {
        zscore_threshold: f64,
        window_minutes: u64,
        #[serde(default = "default_wildcard")]
        task_name: String,
    },
    /// Trigger when error rate spikes compared to recent baseline.
    #[serde(rename = "error_rate_spike")]
    ErrorRateSpike { spike_factor: f64, baseline_hours: u64, task_name: String },
}

/// Alert notification channel configuration.
///
/// The `*_connection` variants reference a reusable, encrypted `integrations`
/// row instead of embedding a plaintext secret. The legacy inline variants
/// (`slack`/`webhook`/`pagerduty`) are retained so existing rules keep working
/// untouched — this enum is internally tagged, so old rows deserialize as-is.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type")]
pub enum AlertChannel {
    #[serde(rename = "slack")]
    Slack {
        webhook_url: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        min_severity: Option<String>,
    },
    #[serde(rename = "email")]
    Email {
        to: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        min_severity: Option<String>,
    },
    #[serde(rename = "webhook")]
    Webhook {
        url: String,
        headers: Option<HashMap<String, String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        min_severity: Option<String>,
    },
    #[serde(rename = "pagerduty")]
    PagerDuty {
        routing_key: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        min_severity: Option<String>,
    },
    /// Slack via a connected bot-token integration; posts to a chosen channel.
    #[serde(rename = "slack_connection")]
    SlackConnection {
        integration_id: Uuid,
        channel_id: String,
        channel_name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        min_severity: Option<String>,
    },
    /// Discord via a connected incoming-webhook integration.
    #[serde(rename = "discord_connection")]
    DiscordConnection {
        integration_id: Uuid,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        min_severity: Option<String>,
    },
    /// PagerDuty via a connected (encrypted routing-key) integration.
    #[serde(rename = "pagerduty_connection")]
    PagerDutyConnection {
        integration_id: Uuid,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        min_severity: Option<String>,
    },
    /// Generic webhook via a connected (encrypted) integration.
    #[serde(rename = "webhook_connection")]
    WebhookConnection {
        integration_id: Uuid,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        min_severity: Option<String>,
    },
}

impl AlertChannel {
    /// The integration this channel references, if any (`*_connection` variants).
    pub fn integration_id(&self) -> Option<Uuid> {
        match self {
            AlertChannel::SlackConnection { integration_id, .. }
            | AlertChannel::DiscordConnection { integration_id, .. }
            | AlertChannel::PagerDutyConnection { integration_id, .. }
            | AlertChannel::WebhookConnection { integration_id, .. } => Some(*integration_id),
            _ => None,
        }
    }

    /// The channel's severity floor, if configured. Alerts below it skip this
    /// channel (e.g. `critical` keeps warnings out of PagerDuty).
    pub fn min_severity(&self) -> Option<&str> {
        match self {
            AlertChannel::Slack { min_severity, .. }
            | AlertChannel::Email { min_severity, .. }
            | AlertChannel::Webhook { min_severity, .. }
            | AlertChannel::PagerDuty { min_severity, .. }
            | AlertChannel::SlackConnection { min_severity, .. }
            | AlertChannel::DiscordConnection { min_severity, .. }
            | AlertChannel::PagerDutyConnection { min_severity, .. }
            | AlertChannel::WebhookConnection { min_severity, .. } => min_severity.as_deref(),
        }
    }
}

/// Delivery status for a single notification channel.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ChannelDeliveryStatus {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ─────────────────────────── Integrations ───────────────────────────

/// A reusable, connected notification service (Slack workspace, Discord
/// webhook, PagerDuty service, generic webhook). The secret (bot token /
/// webhook URL / routing key) is stored encrypted in `secret_enc`; non-secret
/// metadata (team_id, channel_id, …) lives in `config`.
#[derive(Debug, Clone, FromRow)]
pub struct Integration {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub kind: String,
    pub name: String,
    pub status: String,
    pub config: Json<serde_json::Value>,
    /// Versioned AES-GCM ciphertext. Never serialized to API responses.
    pub secret_enc: Option<Vec<u8>>,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Integration {
    /// Project to the API-safe view (drops `secret_enc`).
    pub fn to_view(&self) -> IntegrationView {
        IntegrationView {
            id: self.id,
            kind: self.kind.clone(),
            name: self.name.clone(),
            status: self.status.clone(),
            config: self.config.0.clone(),
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

/// API-facing integration shape — deliberately has no secret field so the
/// ciphertext can never leak into responses or the generated OpenAPI schema.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct IntegrationView {
    pub id: Uuid,
    pub kind: String,
    pub name: String,
    pub status: String,
    pub config: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Insert/upsert payload for an integration.
#[derive(Debug, Clone)]
pub struct NewIntegration {
    pub tenant_id: Uuid,
    pub kind: String,
    pub name: String,
    pub config: serde_json::Value,
    pub secret_enc: Vec<u8>,
    pub created_by: Option<Uuid>,
}

// ─────────────────────────── Tenants ───────────────────────────

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, ToSchema)]
pub struct Tenant {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub settings: serde_json::Value,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTenant {
    pub name: String,
    pub slug: String,
}

// ─────────────────────────── Users ───────────────────────────

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, ToSchema)]
pub struct User {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub display_name: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateUser {
    pub tenant_id: Uuid,
    pub email: String,
    pub password_hash: String,
    pub display_name: Option<String>,
}

/// User response without sensitive fields.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct UserResponse {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

// ─────────────────────────── User invites ───────────────────────────

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct UserInvite {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub email: String,
    pub role_name: String,
    pub token_hash: String,
    pub invited_by: Option<Uuid>,
    pub expires_at: DateTime<Utc>,
    pub accepted_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug)]
pub struct CreateUserInvite {
    pub tenant_id: Uuid,
    pub email: String,
    pub role_name: String,
    pub token_hash: String,
    pub invited_by: Option<Uuid>,
    pub expires_at: DateTime<Utc>,
}

impl From<User> for UserResponse {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            tenant_id: u.tenant_id,
            email: u.email,
            display_name: u.display_name,
            is_active: u.is_active,
            created_at: u.created_at,
        }
    }
}

// ─────────────────────────── Roles ───────────────────────────

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, ToSchema)]
pub struct Role {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub name: String,
    #[schema(value_type = Vec<String>)]
    pub permissions: Json<Vec<String>>,
    pub is_system: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct UserRole {
    pub user_id: Uuid,
    pub role_id: Uuid,
}

// ─────────────────────────── Alert Rules ───────────────────────────

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, ToSchema)]
pub struct AlertRule {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub is_enabled: bool,
    #[schema(value_type = AlertCondition)]
    pub condition: Json<AlertCondition>,
    #[schema(value_type = Vec<AlertChannel>)]
    pub channels: Json<Vec<AlertChannel>>,
    pub cooldown_secs: i32,
    /// Overrides the severity derived from the condition type when set
    /// (`info` | `warning` | `critical`).
    pub severity_override: Option<String>,
    pub last_fired_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAlertRule {
    pub tenant_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub condition: AlertCondition,
    pub channels: Vec<AlertChannel>,
    pub cooldown_secs: Option<i32>,
    pub severity_override: Option<String>,
}

// ─────────────────────────── Alert Silences ───────────────────────────

/// A maintenance window: notifications are suppressed while a matching
/// silence is active. Incidents still open and resolve so history stays
/// truthful. `rule_id` NULL silences every rule in the tenant.
#[derive(Debug, Clone, FromRow, Serialize, Deserialize, ToSchema)]
pub struct AlertSilence {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub rule_id: Option<Uuid>,
    pub reason: Option<String>,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

// ─────────────────────────── Alert History ───────────────────────────

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, ToSchema)]
pub struct AlertHistoryRow {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub rule_id: Uuid,
    pub fired_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub severity: String,
    pub summary: String,
    #[schema(value_type = HashMap<String, serde_json::Value>)]
    pub details: Json<HashMap<String, serde_json::Value>>,
    #[schema(value_type = HashMap<String, ChannelDeliveryStatus>)]
    pub channels_sent: Json<HashMap<String, ChannelDeliveryStatus>>,
}

// ─────────────────────────── API Keys ───────────────────────────

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, ToSchema)]
pub struct ApiKey {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub created_by: Uuid,
    pub name: String,
    pub key_prefix: String,
    #[serde(skip_serializing)]
    pub key_hash: String,
    #[schema(value_type = Vec<String>)]
    pub permissions: Json<Vec<String>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateApiKey {
    pub tenant_id: Uuid,
    pub created_by: Uuid,
    pub name: String,
    pub key_prefix: String,
    pub key_hash: String,
    pub permissions: Vec<String>,
    pub expires_at: Option<DateTime<Utc>>,
}

// ─────────────────────────── Broker Configs ───────────────────────────

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, ToSchema)]
pub struct BrokerConfig {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub name: String,
    pub broker_type: String,
    #[serde(skip_serializing)]
    pub connection_enc: String,
    pub is_active: bool,
    pub status: String,
    pub last_error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateBrokerConfig {
    pub tenant_id: Uuid,
    pub name: String,
    pub broker_type: String,
    pub connection_enc: String,
}

// ─────────────────────────── Retention Policies ───────────────────────────

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, ToSchema)]
pub struct RetentionPolicy {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub resource_type: String,
    pub retention_days: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> DateTime<Utc> {
        Utc::now()
    }

    // ── AlertChannel back-compat (additive enum must not break old rows) ──

    #[test]
    fn legacy_alert_channels_still_deserialize() {
        let slack: AlertChannel =
            serde_json::from_str(r#"{"type":"slack","webhook_url":"https://hooks.slack.com/x"}"#)
                .unwrap();
        assert!(matches!(slack, AlertChannel::Slack { .. }));

        let webhook: AlertChannel = serde_json::from_str(
            r#"{"type":"webhook","url":"https://x.test","headers":{"Authorization":"Bearer t"}}"#,
        )
        .unwrap();
        assert!(matches!(webhook, AlertChannel::Webhook { .. }));

        let pd: AlertChannel =
            serde_json::from_str(r#"{"type":"pagerduty","routing_key":"abc"}"#).unwrap();
        assert!(matches!(pd, AlertChannel::PagerDuty { .. }));

        let email: AlertChannel =
            serde_json::from_str(r#"{"type":"email","to":["a@b.test"]}"#).unwrap();
        assert!(matches!(email, AlertChannel::Email { .. }));
    }

    #[test]
    fn connection_alert_channels_roundtrip_and_expose_integration_id() {
        let id = Uuid::new_v4();
        let json = format!(
            r##"{{"type":"slack_connection","integration_id":"{id}","channel_id":"C1","channel_name":"#alerts"}}"##
        );
        let ch: AlertChannel = serde_json::from_str(&json).unwrap();
        assert_eq!(ch.integration_id(), Some(id));
        assert!(matches!(ch, AlertChannel::SlackConnection { .. }));

        // round-trips back to the tagged form
        assert_eq!(serde_json::to_value(&ch).unwrap()["type"], "slack_connection");

        for kind in ["discord_connection", "pagerduty_connection", "webhook_connection"] {
            let j = format!(r#"{{"type":"{kind}","integration_id":"{id}"}}"#);
            let c: AlertChannel = serde_json::from_str(&j).unwrap();
            assert_eq!(c.integration_id(), Some(id));
        }
    }

    // ── CreateTenant ──

    #[test]
    fn test_create_tenant_deserialization() {
        let ct: CreateTenant = serde_json::from_str(r#"{"name": "Acme", "slug": "acme"}"#).unwrap();
        assert_eq!(ct.name, "Acme");
        assert_eq!(ct.slug, "acme");

        assert!(
            serde_json::from_str::<CreateTenant>(r#"{"name": "Test"}"#).is_err(),
            "slug required"
        );
    }

    // ── User and UserResponse ──

    #[test]
    fn test_user_password_hash_skipped_in_serialization() {
        let user = User {
            id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            email: "user@test.com".to_string(),
            password_hash: "super_secret_hash_value".to_string(),
            display_name: Some("Test User".to_string()),
            is_active: true,
            created_at: now(),
            updated_at: now(),
        };

        let json = serde_json::to_string(&user).unwrap();
        assert!(
            !json.contains("super_secret_hash_value"),
            "password_hash should be skipped during serialization"
        );
        assert!(
            !json.contains("password_hash"),
            "password_hash field name should not appear in serialized output"
        );
    }

    #[test]
    fn test_user_response_from_user_and_password_excluded() {
        let user_id = Uuid::new_v4();
        let user = User {
            id: user_id,
            tenant_id: Uuid::new_v4(),
            email: "alice@example.com".into(),
            password_hash: "argon2id$hash".into(),
            display_name: Some("Alice".into()),
            is_active: true,
            created_at: now(),
            updated_at: now(),
        };
        let response = UserResponse::from(user);
        assert_eq!(response.id, user_id);
        assert_eq!(response.email, "alice@example.com");
        assert_eq!(response.display_name, Some("Alice".to_string()));

        let json = serde_json::to_string(&response).unwrap();
        assert!(!json.contains("argon2id"));
        assert!(!json.contains("password"));
    }

    // ── CreateUser ──

    #[test]
    fn test_create_user_deserialization() {
        let tid = Uuid::new_v4();
        let json = format!(
            r#"{{"tenant_id": "{tid}", "email": "new@example.com", "password_hash": "h", "display_name": "U"}}"#
        );
        let cu: CreateUser = serde_json::from_str(&json).unwrap();
        assert_eq!(cu.email, "new@example.com");
        assert_eq!(cu.display_name, Some("U".to_string()));

        let json = format!(r#"{{"tenant_id": "{tid}", "email": "m@e.com", "password_hash": "h"}}"#);
        assert!(serde_json::from_str::<CreateUser>(&json).unwrap().display_name.is_none());
    }

    // ── CreateAlertRule ──

    #[test]
    fn test_create_alert_rule_deserialization() {
        let tid = Uuid::new_v4();
        let json = format!(
            r#"{{
                "tenant_id": "{tid}",
                "name": "High Failure Rate",
                "description": "Alert when failure rate exceeds 10%",
                "condition": {{"type": "task_failure_rate", "threshold": 0.1, "window_minutes": 5, "task_name": "*"}},
                "channels": [{{"type": "email", "to": ["admin@test.com"]}}, {{"type": "slack", "webhook_url": "https://hooks.slack.com/x"}}],
                "cooldown_secs": 600
            }}"#
        );
        let cr: CreateAlertRule = serde_json::from_str(&json).unwrap();
        assert_eq!(cr.name, "High Failure Rate");
        assert_eq!(cr.description, Some("Alert when failure rate exceeds 10%".to_string()));
        assert_eq!(cr.cooldown_secs, Some(600));
        assert!(matches!(cr.condition, AlertCondition::TaskFailureRate { .. }));
        assert_eq!(cr.channels.len(), 2);
    }

    #[test]
    fn test_create_alert_rule_optional_fields() {
        let tid = Uuid::new_v4();
        let json = format!(
            r#"{{
                "tenant_id": "{tid}",
                "name": "Basic Alert",
                "condition": {{"type": "worker_offline", "grace_period_seconds": 120}},
                "channels": []
            }}"#
        );
        let cr: CreateAlertRule = serde_json::from_str(&json).unwrap();
        assert!(cr.description.is_none());
        assert!(cr.cooldown_secs.is_none());
    }

    // ── ApiKey ──

    #[test]
    fn test_api_key_hash_skipped_in_serialization() {
        let api_key = ApiKey {
            id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            created_by: Uuid::new_v4(),
            name: "My Key".to_string(),
            key_prefix: "abcd1234".to_string(),
            key_hash: "secret_hash_value".to_string(),
            permissions: Json(vec!["tasks_read".to_string()]),
            expires_at: None,
            last_used_at: None,
            is_active: true,
            created_at: now(),
        };

        let json = serde_json::to_string(&api_key).unwrap();
        assert!(
            !json.contains("secret_hash_value"),
            "key_hash should be skipped during serialization"
        );
    }

    // ── BrokerConfig ──

    #[test]
    fn test_broker_config_serialization() {
        let config = BrokerConfig {
            id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            name: "Production RabbitMQ".to_string(),
            broker_type: "rabbitmq".to_string(),
            connection_enc: "encrypted_connection_string".to_string(),
            is_active: true,
            status: "connected".to_string(),
            last_error: None,
            created_at: now(),
            updated_at: now(),
        };

        let json = serde_json::to_string(&config).unwrap();
        assert!(!json.contains("encrypted_connection_string"), "connection_enc should be skipped");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&json).unwrap()["name"],
            "Production RabbitMQ"
        );
    }
}
