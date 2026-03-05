use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Task states matching Celery conventions, extended for other queues.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskState {
    Pending,
    Received,
    Started,
    Success,
    Failure,
    Retry,
    Revoked,
    Rejected,
}

impl TaskState {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            TaskState::Success | TaskState::Failure | TaskState::Revoked | TaskState::Rejected
        )
    }

    pub fn is_active(&self) -> bool {
        matches!(self, TaskState::Started)
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            TaskState::Pending => "PENDING",
            TaskState::Received => "RECEIVED",
            TaskState::Started => "STARTED",
            TaskState::Success => "SUCCESS",
            TaskState::Failure => "FAILURE",
            TaskState::Retry => "RETRY",
            TaskState::Revoked => "REVOKED",
            TaskState::Rejected => "REJECTED",
        }
    }
}

impl std::fmt::Display for TaskState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for TaskState {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_uppercase().as_str() {
            "PENDING" => Ok(TaskState::Pending),
            "RECEIVED" => Ok(TaskState::Received),
            "STARTED" => Ok(TaskState::Started),
            "SUCCESS" => Ok(TaskState::Success),
            "FAILURE" => Ok(TaskState::Failure),
            "RETRY" => Ok(TaskState::Retry),
            "REVOKED" => Ok(TaskState::Revoked),
            "REJECTED" => Ok(TaskState::Rejected),
            _ => Err(format!("Unknown task state: {s}")),
        }
    }
}

/// Worker status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkerStatus {
    Online,
    Offline,
    Heartbeat,
}

impl WorkerStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            WorkerStatus::Online => "online",
            WorkerStatus::Offline => "offline",
            WorkerStatus::Heartbeat => "heartbeat",
        }
    }
}

impl std::fmt::Display for WorkerStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Supported task queue types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CollectorType {
    Celery,
    Dramatiq,
    Huey,
    Taskiq,
    Generic,
}

impl CollectorType {
    pub fn as_str(&self) -> &'static str {
        match self {
            CollectorType::Celery => "celery",
            CollectorType::Dramatiq => "dramatiq",
            CollectorType::Huey => "huey",
            CollectorType::Taskiq => "taskiq",
            CollectorType::Generic => "generic",
        }
    }
}

impl std::fmt::Display for CollectorType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Broker types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BrokerType {
    Rabbitmq,
    Redis,
    Sqs,
    Kafka,
}

/// Tenant plan tiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TenantPlan {
    Free,
    Pro,
    Enterprise,
}

impl Default for TenantPlan {
    fn default() -> Self {
        TenantPlan::Free
    }
}

/// Alert severity levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlertSeverity {
    Info,
    Warning,
    Critical,
}

/// RBAC permission identifiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    TasksRead,
    TasksRetry,
    TasksRevoke,
    WorkersRead,
    WorkersShutdown,
    AlertsRead,
    AlertsWrite,
    BeatRead,
    MetricsRead,
    SettingsRead,
    SettingsWrite,
    TeamManage,
    ApiKeysManage,
    BrokersManage,
}

/// Role presets for system-defined roles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SystemRole {
    Admin,
    Editor,
    Viewer,
    Readonly,
}

impl SystemRole {
    pub fn permissions(&self) -> Vec<Permission> {
        match self {
            SystemRole::Admin => vec![
                Permission::TasksRead,
                Permission::TasksRetry,
                Permission::TasksRevoke,
                Permission::WorkersRead,
                Permission::WorkersShutdown,
                Permission::AlertsRead,
                Permission::AlertsWrite,
                Permission::BeatRead,
                Permission::MetricsRead,
                Permission::SettingsRead,
                Permission::SettingsWrite,
                Permission::TeamManage,
                Permission::ApiKeysManage,
                Permission::BrokersManage,
            ],
            SystemRole::Editor => vec![
                Permission::TasksRead,
                Permission::TasksRetry,
                Permission::WorkersRead,
                Permission::AlertsRead,
                Permission::AlertsWrite,
                Permission::BeatRead,
                Permission::MetricsRead,
                Permission::SettingsRead,
                Permission::ApiKeysManage,
                Permission::BrokersManage,
            ],
            SystemRole::Viewer => vec![
                Permission::TasksRead,
                Permission::WorkersRead,
                Permission::AlertsRead,
                Permission::BeatRead,
                Permission::MetricsRead,
            ],
            SystemRole::Readonly => vec![Permission::TasksRead, Permission::WorkersRead],
        }
    }
}

/// Common ID type alias for clarity.
pub type TenantId = Uuid;
pub type UserId = Uuid;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_state_classification() {
        let terminal = [TaskState::Success, TaskState::Failure, TaskState::Revoked, TaskState::Rejected];
        let non_terminal = [TaskState::Pending, TaskState::Received, TaskState::Started, TaskState::Retry];
        for s in &terminal { assert!(s.is_terminal(), "{s} should be terminal"); }
        for s in &non_terminal { assert!(!s.is_terminal(), "{s} should not be terminal"); }
        assert!(TaskState::Started.is_active());
        assert!(!TaskState::Pending.is_active());
    }

    #[test]
    fn task_state_str_roundtrip_and_serde() {
        let all = [
            (TaskState::Pending, "PENDING"), (TaskState::Received, "RECEIVED"),
            (TaskState::Started, "STARTED"), (TaskState::Success, "SUCCESS"),
            (TaskState::Failure, "FAILURE"), (TaskState::Retry, "RETRY"),
            (TaskState::Revoked, "REVOKED"), (TaskState::Rejected, "REJECTED"),
        ];
        for (state, expected) in &all {
            assert_eq!(state.as_str(), *expected);
            assert_eq!(format!("{state}"), *expected);
            assert_eq!(&expected.parse::<TaskState>().unwrap(), state);
            // serde roundtrip
            let json = serde_json::to_string(state).unwrap();
            assert_eq!(json, format!("\"{expected}\""));
            assert_eq!(&serde_json::from_str::<TaskState>(&json).unwrap(), state);
        }
        // case-insensitive parsing
        assert_eq!("pending".parse::<TaskState>().unwrap(), TaskState::Pending);
        assert_eq!("sUcCeSs".parse::<TaskState>().unwrap(), TaskState::Success);
        assert!("UNKNOWN".parse::<TaskState>().is_err());
    }

    #[test]
    fn enum_serde_roundtrips() {
        // WorkerStatus
        for (v, s) in [(WorkerStatus::Online, "online"), (WorkerStatus::Offline, "offline"), (WorkerStatus::Heartbeat, "heartbeat")] {
            assert_eq!(v.as_str(), s);
            assert_eq!(format!("{v}"), s);
            let json = serde_json::to_string(&v).unwrap();
            assert_eq!(serde_json::from_str::<WorkerStatus>(&json).unwrap(), v);
        }
        // CollectorType
        for (v, s) in [(CollectorType::Celery, "celery"), (CollectorType::Dramatiq, "dramatiq"),
                        (CollectorType::Huey, "huey"), (CollectorType::Taskiq, "taskiq"), (CollectorType::Generic, "generic")] {
            assert_eq!(v.as_str(), s);
            assert_eq!(serde_json::to_string(&v).unwrap(), format!("\"{s}\""));
        }
        // BrokerType
        for (v, s) in [(BrokerType::Rabbitmq, "rabbitmq"), (BrokerType::Redis, "redis"),
                        (BrokerType::Sqs, "sqs"), (BrokerType::Kafka, "kafka")] {
            let json = serde_json::to_string(&v).unwrap();
            assert_eq!(json, format!("\"{s}\""));
            assert_eq!(serde_json::from_str::<BrokerType>(&json).unwrap(), v);
        }
        // AlertSeverity
        assert_eq!(serde_json::to_string(&AlertSeverity::Critical).unwrap(), "\"critical\"");
        // TenantPlan
        assert_eq!(TenantPlan::default(), TenantPlan::Free);
        assert_eq!(serde_json::to_string(&TenantPlan::Enterprise).unwrap(), "\"enterprise\"");
        // Permission
        assert_eq!(serde_json::to_string(&Permission::TasksRead).unwrap(), "\"tasks_read\"");
        assert_eq!(serde_json::to_string(&Permission::ApiKeysManage).unwrap(), "\"api_keys_manage\"");
    }

    #[test]
    fn role_permission_hierarchy() {
        let admin = SystemRole::Admin.permissions();
        let editor = SystemRole::Editor.permissions();
        let viewer = SystemRole::Viewer.permissions();
        let readonly = SystemRole::Readonly.permissions();

        // Strict ordering
        assert!(admin.len() > editor.len());
        assert!(editor.len() > viewer.len());
        assert!(viewer.len() > readonly.len());

        // Admin has all 14
        assert_eq!(admin.len(), 14);
        // Editor is subset of admin
        for p in &editor { assert!(admin.contains(p), "Editor perm {p:?} not in Admin"); }
        // Editor lacks dangerous perms
        assert!(!editor.contains(&Permission::TasksRevoke));
        assert!(!editor.contains(&Permission::WorkersShutdown));
        assert!(!editor.contains(&Permission::TeamManage));
        // Viewer is read-only
        assert!(!viewer.contains(&Permission::TasksRetry));
        assert!(!viewer.contains(&Permission::SettingsWrite));
        // Readonly is minimal
        assert_eq!(readonly.len(), 2);
        assert!(readonly.contains(&Permission::TasksRead));
        assert!(readonly.contains(&Permission::WorkersRead));
    }
}
