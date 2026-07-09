//! Per-rule alert evaluation context, built lazily.
//!
//! Each condition type reads different metrics (ClickHouse aggregates, Redis
//! queue depths, worker liveness), and each rule carries its own window,
//! percentile, task pattern, and grace period. The builder fetches only what
//! the tenant's rules actually need and memoizes per (tenant, parameters)
//! within one evaluation pass, so ten identical rules cost one query. Fetch
//! errors log a warning and leave the metric at its zero default, which never
//! fires (fail closed — no spurious alerts on a flaky datastore).

use std::collections::HashMap;

use alerting::engine::EvaluationContext;
use alerting::stats;
use common::BeatScheduleEntry;
use db::clickhouse::aggregations;
use db::postgres::models::AlertCondition;
use uuid::Uuid;

use crate::state::AppState;

/// Window for conditions that fire on "recent" activity but carry no window
/// parameter of their own (task_failed, task_duration, error_rate_spike's
/// current side). Matches the 60s evaluation cadence with headroom.
const DEFAULT_WINDOW_MINUTES: u64 = 5;
/// Baseline lookback for the z-score anomaly conditions.
const ANOMALY_BASELINE_HOURS: u64 = 24;
/// Widest supported rule window (1 day).
const MAX_WINDOW_MINUTES: u64 = 1440;
/// Widest supported spike baseline (7 days).
const MAX_BASELINE_HOURS: u64 = 24 * 7;
/// How far back to look for the newest event before declaring a tenant silent.
const NO_EVENTS_LOOKBACK_MINUTES: u64 = 60 * 24 * 30;

fn clamp_window(window_minutes: u64) -> u64 {
    window_minutes.clamp(1, MAX_WINDOW_MINUTES)
}

/// Pick the depth for a queue-depth rule: exact queue name, or the deepest
/// queue when the rule says `*`/empty.
fn depth_for_queue(depths: &[(String, u64)], queue: &str) -> u64 {
    if queue.is_empty() || queue == "*" {
        depths.iter().map(|(_, d)| *d).max().unwrap_or(0)
    } else {
        depths.iter().find(|(name, _)| name == queue).map(|(_, d)| *d).unwrap_or(0)
    }
}

/// Effective task pattern for scoped queries: `*`/empty means tenant-wide.
fn pattern_of(condition: &AlertCondition) -> String {
    alerting::engine::task_pattern(condition).unwrap_or("*").to_string()
}

#[derive(Default)]
struct Memo {
    overview: HashMap<(u64, String, u32), aggregations::OverviewStats>,
    queue_depths: Option<Vec<(String, u64)>>,
    beat_entries: Option<Vec<BeatScheduleEntry>>,
    last_event_age: Option<Option<f64>>,
    worker_liveness: Option<(usize, usize)>,
    workers_last_seen: Option<Option<f64>>,
    has_active_broker: Option<bool>,
    throughput: HashMap<(u64, String), stats::ZScore>,
    latency: HashMap<(u64, String), stats::ZScore>,
    error_spike: HashMap<(u64, String), stats::Spike>,
}

pub struct AlertContextBuilder<'a> {
    state: &'a AppState,
    tenant_id: Uuid,
    memo: Memo,
}

impl<'a> AlertContextBuilder<'a> {
    pub fn new(state: &'a AppState, tenant_id: Uuid) -> Self {
        Self { state, tenant_id, memo: Memo::default() }
    }

    /// Build the evaluation context for one rule, fetching only the metrics
    /// its condition type reads.
    pub async fn context_for(&mut self, condition: &AlertCondition) -> EvaluationContext {
        let mut ctx = EvaluationContext::default();
        match condition {
            AlertCondition::TaskFailureRate { window_minutes, .. } => {
                let stats =
                    self.overview(clamp_window(*window_minutes), pattern_of(condition), 0.95).await;
                if stats.total_tasks > 0 {
                    ctx.failure_rate = stats.failure_count as f64 / stats.total_tasks as f64;
                }
                ctx.recent_failures = stats.failure_count;
            }
            AlertCondition::TaskFailed { .. } => {
                let stats =
                    self.overview(DEFAULT_WINDOW_MINUTES, pattern_of(condition), 0.95).await;
                ctx.recent_failures = stats.failure_count;
            }
            AlertCondition::TaskDuration { percentile, .. } => {
                let level = stats::normalize_percentile(*percentile);
                let stats =
                    self.overview(DEFAULT_WINDOW_MINUTES, pattern_of(condition), level).await;
                // Holds the rule's percentile, not necessarily P95.
                ctx.p95_runtime = stats.p95_runtime;
            }
            AlertCondition::QueueDepth { queue, .. } => {
                let depths = self.queue_depths().await;
                ctx.queue_depth = depth_for_queue(depths, queue);
            }
            AlertCondition::WorkerOffline { grace_period_seconds } => {
                ctx.workers_went_offline = self.workers_offline(*grace_period_seconds).await;
            }
            AlertCondition::BeatMissed { schedule_name } => {
                let entries = self.beat_entries().await;
                let now = common::time::to_unix_f64(&common::time::now());
                ctx.beat_schedules_missed =
                    stats::count_missed_schedules(entries, schedule_name, now);
            }
            AlertCondition::NoEvents { .. } => {
                ctx.seconds_since_last_event = self.seconds_since_last_event().await;
            }
            AlertCondition::ThroughputAnomaly { window_minutes, .. } => {
                let z = self
                    .throughput_zscore(clamp_window(*window_minutes), pattern_of(condition))
                    .await;
                ctx.throughput_zscore = z.zscore;
                // Display values are per-minute rates.
                let w = clamp_window(*window_minutes) as f64;
                ctx.current_throughput = z.current / w;
                ctx.baseline_throughput = z.baseline_mean / w;
            }
            AlertCondition::LatencyAnomaly { window_minutes, .. } => {
                let z =
                    self.latency_zscore(clamp_window(*window_minutes), pattern_of(condition)).await;
                ctx.latency_zscore = z.zscore;
                ctx.current_latency = z.current;
                ctx.baseline_latency = z.baseline_mean;
            }
            AlertCondition::ErrorRateSpike { baseline_hours, .. } => {
                let hours = (*baseline_hours).clamp(1, MAX_BASELINE_HOURS);
                let spike = self.error_spike(hours, pattern_of(condition)).await;
                ctx.error_rate_spike_factor = spike.factor;
                ctx.current_error_rate = spike.current_rate;
                ctx.baseline_error_rate = spike.baseline_rate;
            }
        }
        ctx
    }

    async fn overview(
        &mut self,
        window_minutes: u64,
        pattern: String,
        percentile: f64,
    ) -> aggregations::OverviewStats {
        // f64 isn't hashable; key on the percentile in tenths of a basis point.
        let key = (window_minutes, pattern, (percentile * 10_000.0) as u32);
        if let Some(stats) = self.memo.overview.get(&key) {
            return stats.clone();
        }
        let stats = aggregations::get_alert_overview_stats(
            &self.state.ch,
            self.tenant_id,
            window_minutes,
            &key.1,
            percentile,
        )
        .await
        .unwrap_or_else(|e| {
            tracing::warn!(error = %e, tenant_id = %self.tenant_id, "alert overview stats query failed");
            aggregations::OverviewStats::default()
        });
        self.memo.overview.insert(key, stats.clone());
        stats
    }

    async fn queue_depths(&mut self) -> &[(String, u64)] {
        if self.memo.queue_depths.is_none() {
            let depths = db::redis::cache::get_queue_depths(&self.state.redis, self.tenant_id)
                .await
                .unwrap_or_else(|e| {
                    tracing::warn!(error = ?e, tenant_id = %self.tenant_id, "queue depth read failed");
                    Vec::new()
                });
            self.memo.queue_depths = Some(depths);
        }
        self.memo.queue_depths.as_deref().unwrap_or_default()
    }

    async fn beat_entries(&mut self) -> &[BeatScheduleEntry] {
        if self.memo.beat_entries.is_none() {
            let key = db::redis::keys::beat_schedule(self.tenant_id);
            let entries: Vec<BeatScheduleEntry> =
                db::redis::cache::get_json(&self.state.redis, &key)
                    .await
                    .unwrap_or_else(|e| {
                        tracing::warn!(error = ?e, tenant_id = %self.tenant_id, "beat schedule read failed");
                        None
                    })
                    .unwrap_or_default();
            self.memo.beat_entries = Some(entries);
        }
        self.memo.beat_entries.as_deref().unwrap_or_default()
    }

    async fn has_active_broker(&mut self) -> bool {
        if self.memo.has_active_broker.is_none() {
            let active =
                db::postgres::broker_configs::list_broker_configs(&self.state.pg, self.tenant_id)
                    .await
                    .map(|configs| configs.iter().any(|c| c.is_active))
                    .unwrap_or(false);
            self.memo.has_active_broker = Some(active);
        }
        self.memo.has_active_broker.unwrap_or(false)
    }

    /// Workers considered offline for a rule's grace period. Liveness is the
    /// heartbeat key (90s TTL), not the online set — a crashed worker never
    /// sends `worker-offline` and would otherwise linger in the set forever,
    /// suppressing this alert. Grace periods beyond the TTL are measured via
    /// the persistent last-seen marker.
    async fn workers_offline(&mut self, grace_period_seconds: u64) -> u32 {
        if self.memo.worker_liveness.is_none() {
            let liveness = db::redis::cache::count_live_workers(&self.state.redis, self.tenant_id)
                .await
                .unwrap_or_else(|e| {
                    tracing::warn!(error = ?e, tenant_id = %self.tenant_id, "worker liveness read failed");
                    (0, 1) // fail closed: pretend one live worker
                });
            self.memo.worker_liveness = Some(liveness);
        }
        let (online, live) = self.memo.worker_liveness.unwrap_or((0, 1));
        if live > 0 || !self.has_active_broker().await {
            return 0;
        }

        if self.memo.workers_last_seen.is_none() {
            let seen = db::redis::cache::get_workers_last_seen(&self.state.redis, self.tenant_id)
                .await
                .unwrap_or_else(|e| {
                    tracing::warn!(error = ?e, tenant_id = %self.tenant_id, "workers last-seen read failed");
                    None
                });
            self.memo.workers_last_seen = Some(seen);
        }
        match self.memo.workers_last_seen.flatten() {
            Some(ts) => {
                let age = common::time::to_unix_f64(&common::time::now()) - ts;
                if age >= grace_period_seconds as f64 {
                    online.max(1) as u32
                } else {
                    0
                }
            }
            // No worker ever seen (or pre-upgrade marker missing): an active
            // broker with zero live workers is offline regardless of grace.
            None => online.max(1) as u32,
        }
    }

    /// Age of the newest task event, gated on the tenant having an active
    /// broker (an idle tenant that never connected anything isn't "silent").
    /// A tenant with an active broker and no events in the 30-day lookback
    /// reports the lookback bound, firing any silence threshold up to 30 days.
    async fn seconds_since_last_event(&mut self) -> f64 {
        if !self.has_active_broker().await {
            return 0.0;
        }
        if self.memo.last_event_age.is_none() {
            let age = aggregations::get_seconds_since_last_event(
                &self.state.ch,
                self.tenant_id,
                NO_EVENTS_LOOKBACK_MINUTES,
            )
            .await
            .unwrap_or_else(|e| {
                tracing::warn!(error = %e, tenant_id = %self.tenant_id, "last event age query failed");
                Some(0.0) // fail closed: pretend an event just arrived
            });
            self.memo.last_event_age = Some(age);
        }
        match self.memo.last_event_age.flatten() {
            Some(age) => age,
            None => (NO_EVENTS_LOOKBACK_MINUTES * 60) as f64,
        }
    }

    async fn throughput_zscore(&mut self, window: u64, pattern: String) -> stats::ZScore {
        let key = (window, pattern);
        if let Some(z) = self.memo.throughput.get(&key) {
            return *z;
        }
        let (moments, current) = tokio::join!(
            aggregations::get_throughput_moments(
                &self.state.ch,
                self.tenant_id,
                window,
                ANOMALY_BASELINE_HOURS,
                &key.1,
            ),
            aggregations::get_recent_completed_count(
                &self.state.ch,
                self.tenant_id,
                window,
                &key.1,
            )
        );
        let z = match (moments, current) {
            (Ok(m), Ok(cur)) => {
                let n_total = (ANOMALY_BASELINE_HOURS * 60 / window.max(1)) as f64;
                stats::throughput_zscore(cur as f64, m.bucket_sum, m.bucket_sumsq, n_total)
            }
            (m, c) => {
                let err = m.err().map(|e| e.to_string()).or(c.err().map(|e| e.to_string()));
                tracing::warn!(error = ?err, tenant_id = %self.tenant_id, "throughput anomaly query failed");
                stats::ZScore::default()
            }
        };
        self.memo.throughput.insert(key, z);
        z
    }

    async fn latency_zscore(&mut self, window: u64, pattern: String) -> stats::ZScore {
        let key = (window, pattern);
        if let Some(z) = self.memo.latency.get(&key) {
            return *z;
        }
        let z = match aggregations::get_latency_moments(
            &self.state.ch,
            self.tenant_id,
            window,
            ANOMALY_BASELINE_HOURS,
            &key.1,
        )
        .await
        {
            Ok(m) => stats::latency_zscore(
                m.current_avg,
                m.current_samples,
                m.baseline_avg,
                m.baseline_std,
                m.baseline_samples,
            ),
            Err(e) => {
                tracing::warn!(error = %e, tenant_id = %self.tenant_id, "latency anomaly query failed");
                stats::ZScore::default()
            }
        };
        self.memo.latency.insert(key, z);
        z
    }

    async fn error_spike(&mut self, baseline_hours: u64, pattern: String) -> stats::Spike {
        let key = (baseline_hours, pattern);
        if let Some(s) = self.memo.error_spike.get(&key) {
            return *s;
        }
        let spike = match aggregations::get_error_rate_stats(
            &self.state.ch,
            self.tenant_id,
            DEFAULT_WINDOW_MINUTES,
            baseline_hours,
            &key.1,
        )
        .await
        {
            Ok(s) => stats::error_spike_factor(
                s.current_total,
                s.current_failures,
                s.baseline_total,
                s.baseline_failures,
            ),
            Err(e) => {
                tracing::warn!(error = %e, tenant_id = %self.tenant_id, "error rate spike query failed");
                stats::Spike::default()
            }
        };
        self.memo.error_spike.insert(key, spike);
        spike
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_matching_exact_and_wildcard() {
        let depths =
            vec![("default".to_string(), 10), ("emails".to_string(), 250), ("data".to_string(), 3)];
        assert_eq!(depth_for_queue(&depths, "emails"), 250);
        assert_eq!(depth_for_queue(&depths, "*"), 250);
        assert_eq!(depth_for_queue(&depths, ""), 250);
        assert_eq!(depth_for_queue(&depths, "data"), 3);
        assert_eq!(depth_for_queue(&depths, "missing"), 0);
        assert_eq!(depth_for_queue(&[], "*"), 0);
    }

    #[test]
    fn window_clamping() {
        assert_eq!(clamp_window(0), 1);
        assert_eq!(clamp_window(10), 10);
        assert_eq!(clamp_window(100_000), MAX_WINDOW_MINUTES);
    }
}
