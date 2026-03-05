use serde::{Deserialize, Serialize};

/// Worker detail view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerDetail {
    pub worker_id: String,
    pub hostname: String,
    pub status: String,
    pub active_tasks: u32,
    pub processed: u64,
    pub cpu_percent: f64,
    pub memory_mb: f64,
    pub load_avg: Vec<f64>,
    pub pool_size: u32,
    pub pool_type: String,
    pub sw_ident: String,
    pub sw_ver: String,
    pub last_heartbeat: Option<f64>,
}

/// Worker summary for list views.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerSummary {
    pub worker_id: String,
    pub hostname: String,
    pub status: String,
    pub active_tasks: u32,
    pub processed: u64,
    pub cpu_percent: f64,
    pub memory_mb: f64,
    pub pool_size: u32,
}

/// Configuration for auto-cleanup of offline workers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfflineCleanupConfig {
    /// Grace period in seconds before marking a worker as offline.
    pub grace_period_secs: u64,
    /// Whether to automatically remove offline workers from the dashboard.
    pub auto_remove: bool,
    /// How long to keep offline workers visible before removal.
    pub removal_delay_secs: u64,
}

impl Default for OfflineCleanupConfig {
    fn default() -> Self {
        Self { grace_period_secs: 120, auto_remove: true, removal_delay_secs: 300 }
    }
}
