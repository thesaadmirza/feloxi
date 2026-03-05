use serde::{Deserialize, Serialize};

/// Dashboard overview metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardOverview {
    pub total_tasks: u64,
    pub success_count: u64,
    pub failure_count: u64,
    pub active_workers: u64,
    pub active_queues: u64,
    pub avg_runtime_secs: f64,
    pub p95_runtime_secs: f64,
    pub avg_wait_time_secs: f64,
    pub failure_rate: f64,
    pub throughput_per_min: f64,
}

/// Time-series data point for charts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeSeriesPoint {
    pub timestamp: f64,
    pub value: f64,
}

/// Throughput metrics for a time range.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThroughputMetrics {
    pub total: Vec<TimeSeriesPoint>,
    pub success: Vec<TimeSeriesPoint>,
    pub failure: Vec<TimeSeriesPoint>,
    pub retry: Vec<TimeSeriesPoint>,
}

/// Latency percentiles.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatencyMetrics {
    pub p50: Vec<TimeSeriesPoint>,
    pub p95: Vec<TimeSeriesPoint>,
    pub p99: Vec<TimeSeriesPoint>,
}

/// Queue stats.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueStats {
    pub queue_name: String,
    pub depth: u64,
    pub consumers: u32,
    pub enqueue_rate: f64,
    pub dequeue_rate: f64,
    pub avg_wait_time_secs: f64,
}
