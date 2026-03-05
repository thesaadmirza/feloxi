//! Typed response structs for all API endpoints.
//!
//! These types are used in utoipa `body = ...` annotations so that
//! the generated OpenAPI spec includes proper response schemas.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use db::clickhouse::aggregations::{QueueMetricsRow, TaskMetricsRow};
use db::clickhouse::task_events::TaskEventRow;
use db::clickhouse::worker_events::WorkerEventRow;
use db::postgres::models::{
    AlertHistoryRow, AlertRule, ApiKey, BrokerConfig, Role,
};

use crate::broker_conn::commands::QueueInfo;

// ─── Tasks ─────────────────────────────────────────────

#[derive(Serialize, ToSchema)]
pub struct TaskListResponse {
    pub data: Vec<TaskEventRow>,
    pub has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
}

/// Task event timeline (all state transitions for a single task).
#[derive(Serialize, ToSchema)]
pub struct TaskTimelineResponse {
    pub timeline: Vec<TaskEventRow>,
}

/// Response for task retry/revoke and worker shutdown commands.
#[derive(Serialize, ToSchema)]
pub struct CommandResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_id: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

// ─── Workers ───────────────────────────────────────────

/// Cached worker state from Redis (set by broker pipeline on heartbeat events).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct WorkerState {
    pub worker_id: String,
    pub hostname: String,
    pub status: String,
    pub active_tasks: u32,
    pub processed: u64,
    pub load_avg: Vec<f64>,
    pub cpu_percent: f64,
    pub memory_mb: f64,
    pub pool_size: u32,
    pub pool_type: String,
    pub sw_ident: String,
    pub sw_ver: String,
}

/// Worker list with online set, ClickHouse events, and Redis states.
#[derive(Serialize, ToSchema)]
pub struct WorkerListResponse {
    pub online_workers: Vec<String>,
    pub worker_events: Vec<WorkerEventRow>,
    pub worker_states: Vec<WorkerState>,
}

/// Single worker detail with current state and recent events.
#[derive(Serialize, ToSchema)]
pub struct WorkerDetailResponse {
    pub worker_id: String,
    pub current_state: Option<WorkerState>,
    pub recent_events: Vec<WorkerEventRow>,
}

// ─── Metrics ───────────────────────────────────────────

/// Dashboard overview metrics (computed from ClickHouse + Redis).
#[derive(Serialize, ToSchema)]
pub struct OverviewResponse {
    pub total_tasks: u64,
    pub success_count: u64,
    pub failure_count: u64,
    pub failure_rate: f64,
    pub avg_runtime: f64,
    pub p95_runtime: f64,
    pub avg_wait_time: f64,
    pub active_workers: usize,
    pub period_minutes: u64,
}

/// Throughput time-series data.
#[derive(Serialize, ToSchema)]
pub struct ThroughputResponse {
    pub data: Vec<TaskMetricsRow>,
}

/// Queue metrics time-series data.
#[derive(Serialize, ToSchema)]
pub struct QueueMetricsResponse {
    pub data: Vec<QueueMetricsRow>,
}

/// List of string values (task names, queue names).
#[derive(Serialize, ToSchema)]
pub struct StringListResponse {
    pub data: Vec<String>,
}

// ─── Brokers ───────────────────────────────────────────

/// List of broker configurations.
#[derive(Serialize, ToSchema)]
pub struct BrokerListResponse {
    pub data: Vec<BrokerConfig>,
}

/// List of queue depths from a broker.
#[derive(Serialize, ToSchema)]
pub struct QueueListResponse {
    pub data: Vec<QueueInfo>,
}

/// Broker connection test result.
#[derive(Serialize, ToSchema)]
pub struct TestConnectionResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ─── Alerts ────────────────────────────────────────────

/// List of alert rules.
#[derive(Serialize, ToSchema)]
pub struct AlertRulesResponse {
    pub data: Vec<AlertRule>,
}

#[derive(Serialize, ToSchema)]
pub struct AlertHistoryResponse {
    pub data: Vec<AlertHistoryRow>,
    pub has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
}

// ─── API Keys ──────────────────────────────────────────

/// List of API keys.
#[derive(Serialize, ToSchema)]
pub struct ApiKeyListResponse {
    pub data: Vec<ApiKey>,
}

/// Response after creating an API key (includes the raw key, shown once).
#[derive(Serialize, ToSchema)]
pub struct CreateApiKeyResponse {
    pub key: String,
    #[schema(value_type = String, format = "uuid")]
    pub id: uuid::Uuid,
    pub name: String,
    pub key_prefix: String,
    pub message: String,
}

// ─── Settings / Tenants ────────────────────────────────

/// Team member (user with roles).
#[derive(Serialize, ToSchema)]
pub struct TeamMember {
    #[schema(value_type = String, format = "uuid")]
    pub id: uuid::Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub is_active: bool,
    #[schema(value_type = String, format = "date-time")]
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub roles: Vec<String>,
}

/// Team response (members + available roles).
#[derive(Serialize, ToSchema)]
pub struct TeamResponse {
    pub members: Vec<TeamMember>,
    pub roles: Vec<Role>,
}

/// Invite member response.
#[derive(Serialize, ToSchema)]
pub struct InviteMemberResponse {
    #[schema(value_type = String, format = "uuid")]
    pub id: uuid::Uuid,
    pub email: String,
    pub role: String,
}

/// Data retention configuration.
#[derive(Serialize, ToSchema)]
pub struct RetentionResponse {
    pub task_events_days: i32,
    pub worker_events_days: i32,
    pub alert_history_days: i32,
}

/// Notification settings (SMTP + webhook defaults).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct NotificationSettings {
    #[serde(default)]
    pub smtp: SmtpSettings,
    #[serde(default)]
    pub webhook_defaults: WebhookDefaults,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Default)]
pub struct SmtpSettings {
    #[serde(default)]
    pub host: String,
    #[serde(default = "default_smtp_port")]
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(default, skip_serializing)]
    pub password: String,
    #[serde(default)]
    pub from_address: String,
    #[serde(default = "default_tls")]
    pub tls: bool,
    /// Indicates whether a password has been set (for UI display).
    #[serde(default, skip_deserializing)]
    pub has_password: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct WebhookDefaults {
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u32,
    #[serde(default = "default_retries")]
    pub retry_count: u32,
}

fn default_smtp_port() -> u16 {
    587
}
fn default_tls() -> bool {
    true
}
fn default_timeout() -> u32 {
    10
}
fn default_retries() -> u32 {
    1
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self {
            smtp: SmtpSettings::default(),
            webhook_defaults: WebhookDefaults::default(),
        }
    }
}

impl Default for WebhookDefaults {
    fn default() -> Self {
        Self {
            timeout_seconds: 10,
            retry_count: 1,
        }
    }
}
