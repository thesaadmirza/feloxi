use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::rules::{AlertCondition, ResolvedAlertRule};

/// An alert that has been triggered.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FiredAlert {
    pub id: Uuid,
    pub rule_id: Uuid,
    pub tenant_id: Uuid,
    pub rule_name: String,
    pub severity: String,
    pub summary: String,
    pub details: serde_json::Value,
    pub fired_at: f64,
}

/// Evaluate an alert condition (returns true if the condition is met).
pub fn evaluate_condition(
    condition: &AlertCondition,
    context: &EvaluationContext,
) -> bool {
    match condition {
        AlertCondition::TaskFailureRate {
            threshold,
            window_minutes: _,
            task_name: _,
        } => context.failure_rate > *threshold,

        AlertCondition::QueueDepth { threshold, queue: _ } => {
            context.queue_depth > *threshold
        }

        AlertCondition::WorkerOffline {
            grace_period_seconds: _,
        } => context.workers_went_offline > 0,

        AlertCondition::TaskDuration {
            threshold_seconds,
            percentile: _,
            task_name: _,
        } => context.p95_runtime > *threshold_seconds,

        AlertCondition::BeatMissed { schedule_name: _ } => context.beat_schedules_missed > 0,

        AlertCondition::TaskFailed { task_name: _ } => context.recent_failures > 0,

        AlertCondition::NoEvents { silence_minutes } => {
            context.seconds_since_last_event > (*silence_minutes * 60) as f64
        }

        AlertCondition::ThroughputAnomaly {
            zscore_threshold,
            window_minutes: _,
            task_name: _,
        } => context.throughput_zscore.abs() > *zscore_threshold,

        AlertCondition::LatencyAnomaly {
            zscore_threshold,
            window_minutes: _,
            task_name: _,
        } => context.latency_zscore > *zscore_threshold,

        AlertCondition::ErrorRateSpike {
            spike_factor,
            baseline_hours: _,
            task_name: _,
        } => context.error_rate_spike_factor > *spike_factor,
    }
}

/// Context data gathered for alert evaluation.
#[derive(Debug, Clone, Default)]
pub struct EvaluationContext {
    pub failure_rate: f64,
    pub queue_depth: u64,
    pub workers_went_offline: u32,
    pub p95_runtime: f64,
    pub beat_schedules_missed: u32,
    pub recent_failures: u64,
    pub seconds_since_last_event: f64,
    /// Z-score of current throughput vs historical mean.
    pub throughput_zscore: f64,
    /// Z-score of current latency vs historical mean.
    pub latency_zscore: f64,
    /// Ratio of current error rate to baseline error rate.
    pub error_rate_spike_factor: f64,
    /// Current throughput (tasks/min) for summary messages.
    pub current_throughput: f64,
    /// Historical mean throughput for summary messages.
    pub baseline_throughput: f64,
    /// Current mean latency (seconds) for summary messages.
    pub current_latency: f64,
    /// Historical mean latency (seconds) for summary messages.
    pub baseline_latency: f64,
    /// Current error rate for summary messages.
    pub current_error_rate: f64,
    /// Baseline error rate for summary messages.
    pub baseline_error_rate: f64,
}

/// Determine alert severity from condition type and severity of breach.
pub fn determine_severity(condition: &AlertCondition) -> &'static str {
    match condition {
        AlertCondition::WorkerOffline { .. } => "critical",
        AlertCondition::BeatMissed { .. } => "critical",
        AlertCondition::TaskFailureRate { threshold, .. } if *threshold > 0.5 => "critical",
        AlertCondition::TaskFailureRate { .. } => "warning",
        AlertCondition::QueueDepth { .. } => "warning",
        AlertCondition::TaskDuration { .. } => "warning",
        AlertCondition::TaskFailed { .. } => "warning",
        AlertCondition::NoEvents { .. } => "critical",
        AlertCondition::ThroughputAnomaly { zscore_threshold, .. } if *zscore_threshold > 3.0 => "critical",
        AlertCondition::ThroughputAnomaly { .. } => "warning",
        AlertCondition::LatencyAnomaly { zscore_threshold, .. } if *zscore_threshold > 3.0 => "critical",
        AlertCondition::LatencyAnomaly { .. } => "warning",
        AlertCondition::ErrorRateSpike { spike_factor, .. } if *spike_factor > 5.0 => "critical",
        AlertCondition::ErrorRateSpike { .. } => "warning",
    }
}

/// Generate a human-readable summary for a fired alert.
pub fn generate_summary(rule: &ResolvedAlertRule, context: &EvaluationContext) -> String {
    match &rule.condition {
        AlertCondition::TaskFailureRate { threshold, task_name, .. } => {
            format!(
                "Task failure rate for '{}' is {:.1}% (threshold: {:.1}%)",
                task_name,
                context.failure_rate * 100.0,
                threshold * 100.0
            )
        }
        AlertCondition::QueueDepth { threshold, queue } => {
            format!(
                "Queue '{}' depth is {} (threshold: {})",
                queue, context.queue_depth, threshold
            )
        }
        AlertCondition::WorkerOffline { .. } => {
            format!(
                "{} worker(s) went offline",
                context.workers_went_offline
            )
        }
        AlertCondition::TaskDuration { threshold_seconds, task_name, .. } => {
            format!(
                "Task '{}' P95 runtime is {:.1}s (threshold: {:.1}s)",
                task_name, context.p95_runtime, threshold_seconds
            )
        }
        AlertCondition::BeatMissed { schedule_name } => {
            format!("Beat schedule '{}' missed its expected run", schedule_name)
        }
        AlertCondition::TaskFailed { task_name } => {
            format!("Task '{}' failed ({} recent failures)", task_name, context.recent_failures)
        }
        AlertCondition::NoEvents { silence_minutes } => {
            format!(
                "No events received for {:.0} minutes (threshold: {} minutes)",
                context.seconds_since_last_event / 60.0,
                silence_minutes
            )
        }
        AlertCondition::ThroughputAnomaly { task_name, .. } => {
            format!(
                "Throughput anomaly for '{}': {:.1} tasks/min (baseline: {:.1}, Z-score: {:.1})",
                task_name, context.current_throughput, context.baseline_throughput, context.throughput_zscore
            )
        }
        AlertCondition::LatencyAnomaly { task_name, .. } => {
            format!(
                "Latency anomaly for '{}': {:.2}s (baseline: {:.2}s, Z-score: {:.1})",
                task_name, context.current_latency, context.baseline_latency, context.latency_zscore
            )
        }
        AlertCondition::ErrorRateSpike { task_name, .. } => {
            format!(
                "Error rate spike for '{}': {:.1}% (baseline: {:.1}%, {:.1}x increase)",
                task_name,
                context.current_error_rate * 100.0,
                context.baseline_error_rate * 100.0,
                context.error_rate_spike_factor
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_rule(condition: AlertCondition) -> ResolvedAlertRule {
        ResolvedAlertRule {
            id: Uuid::nil(), tenant_id: Uuid::nil(), name: "Test Rule".into(),
            condition, channels: vec![], cooldown_secs: 60,
        }
    }

    #[test]
    fn evaluate_condition_all_types() {
        // (condition, context, expected_trigger)
        let cases: Vec<(AlertCondition, EvaluationContext, bool)> = vec![
            // TaskFailureRate: above → true, at → false, below → false
            (AlertCondition::TaskFailureRate { threshold: 0.1, window_minutes: 5, task_name: "t".into() },
             EvaluationContext { failure_rate: 0.15, ..Default::default() }, true),
            (AlertCondition::TaskFailureRate { threshold: 0.1, window_minutes: 5, task_name: "t".into() },
             EvaluationContext { failure_rate: 0.1, ..Default::default() }, false),
            (AlertCondition::TaskFailureRate { threshold: 0.1, window_minutes: 5, task_name: "t".into() },
             EvaluationContext { failure_rate: 0.05, ..Default::default() }, false),
            // QueueDepth: above → true, at → false
            (AlertCondition::QueueDepth { threshold: 100, queue: "q".into() },
             EvaluationContext { queue_depth: 150, ..Default::default() }, true),
            (AlertCondition::QueueDepth { threshold: 100, queue: "q".into() },
             EvaluationContext { queue_depth: 100, ..Default::default() }, false),
            // WorkerOffline: >0 → true, 0 → false
            (AlertCondition::WorkerOffline { grace_period_seconds: 60 },
             EvaluationContext { workers_went_offline: 1, ..Default::default() }, true),
            (AlertCondition::WorkerOffline { grace_period_seconds: 60 },
             EvaluationContext { workers_went_offline: 0, ..Default::default() }, false),
            // TaskDuration: above → true, at → false
            (AlertCondition::TaskDuration { threshold_seconds: 10.0, percentile: 95.0, task_name: "t".into() },
             EvaluationContext { p95_runtime: 15.0, ..Default::default() }, true),
            (AlertCondition::TaskDuration { threshold_seconds: 10.0, percentile: 95.0, task_name: "t".into() },
             EvaluationContext { p95_runtime: 10.0, ..Default::default() }, false),
            // BeatMissed: >0 → true, 0 → false
            (AlertCondition::BeatMissed { schedule_name: "s".into() },
             EvaluationContext { beat_schedules_missed: 1, ..Default::default() }, true),
            (AlertCondition::BeatMissed { schedule_name: "s".into() },
             EvaluationContext { beat_schedules_missed: 0, ..Default::default() }, false),
            // TaskFailed: >0 → true, 0 → false
            (AlertCondition::TaskFailed { task_name: "p".into() },
             EvaluationContext { recent_failures: 3, ..Default::default() }, true),
            (AlertCondition::TaskFailed { task_name: "p".into() },
             EvaluationContext { recent_failures: 0, ..Default::default() }, false),
            // NoEvents: past silence → true, at → false, within → false
            (AlertCondition::NoEvents { silence_minutes: 5 },
             EvaluationContext { seconds_since_last_event: 301.0, ..Default::default() }, true),
            (AlertCondition::NoEvents { silence_minutes: 5 },
             EvaluationContext { seconds_since_last_event: 300.0, ..Default::default() }, false),
        ];

        for (i, (cond, ctx, expected)) in cases.iter().enumerate() {
            assert_eq!(evaluate_condition(cond, ctx), *expected, "case {i} failed");
        }
    }

    #[test]
    fn determine_severity_all_types() {
        let cases: Vec<(AlertCondition, &str)> = vec![
            (AlertCondition::WorkerOffline { grace_period_seconds: 60 }, "critical"),
            (AlertCondition::BeatMissed { schedule_name: "x".into() }, "critical"),
            (AlertCondition::NoEvents { silence_minutes: 10 }, "critical"),
            (AlertCondition::TaskFailureRate { threshold: 0.51, window_minutes: 5, task_name: "x".into() }, "critical"),
            (AlertCondition::TaskFailureRate { threshold: 0.1, window_minutes: 5, task_name: "x".into() }, "warning"),
            (AlertCondition::TaskFailureRate { threshold: 0.5, window_minutes: 5, task_name: "x".into() }, "warning"),
            (AlertCondition::QueueDepth { threshold: 100, queue: "q".into() }, "warning"),
            (AlertCondition::TaskDuration { threshold_seconds: 30.0, percentile: 95.0, task_name: "x".into() }, "warning"),
            (AlertCondition::TaskFailed { task_name: "x".into() }, "warning"),
        ];
        for (cond, expected) in &cases {
            assert_eq!(determine_severity(cond), *expected);
        }
    }

    #[test]
    fn generate_summary_all_types() {
        let cases: Vec<(AlertCondition, EvaluationContext, Vec<&str>)> = vec![
            (AlertCondition::TaskFailureRate { threshold: 0.1, window_minutes: 5, task_name: "tasks.add".into() },
             EvaluationContext { failure_rate: 0.25, ..Default::default() },
             vec!["tasks.add", "25.0%", "10.0%"]),
            (AlertCondition::QueueDepth { threshold: 500, queue: "celery".into() },
             EvaluationContext { queue_depth: 750, ..Default::default() },
             vec!["celery", "750", "500"]),
            (AlertCondition::WorkerOffline { grace_period_seconds: 60 },
             EvaluationContext { workers_went_offline: 3, ..Default::default() },
             vec!["3 worker(s) went offline"]),
            (AlertCondition::TaskDuration { threshold_seconds: 10.0, percentile: 95.0, task_name: "tasks.heavy".into() },
             EvaluationContext { p95_runtime: 15.5, ..Default::default() },
             vec!["tasks.heavy", "15.5s", "10.0s"]),
            (AlertCondition::BeatMissed { schedule_name: "nightly_cleanup".into() },
             EvaluationContext::default(),
             vec!["nightly_cleanup", "missed"]),
            (AlertCondition::TaskFailed { task_name: "tasks.payment".into() },
             EvaluationContext { recent_failures: 5, ..Default::default() },
             vec!["tasks.payment", "5 recent failures"]),
            (AlertCondition::NoEvents { silence_minutes: 10 },
             EvaluationContext { seconds_since_last_event: 900.0, ..Default::default() },
             vec!["15 minutes", "10 minutes"]),
        ];
        for (cond, ctx, expected_parts) in &cases {
            let rule = make_rule(cond.clone());
            let summary = generate_summary(&rule, ctx);
            for part in expected_parts {
                assert!(summary.contains(part), "summary {summary:?} missing {part:?}");
            }
        }
    }

    #[test]
    fn evaluation_context_default_all_zeros() {
        let ctx = EvaluationContext::default();
        assert!((ctx.failure_rate).abs() < f64::EPSILON);
        assert_eq!(ctx.queue_depth, 0);
        assert_eq!(ctx.workers_went_offline, 0);
        assert_eq!(ctx.recent_failures, 0);
    }

    #[test]
    fn fired_alert_serde_roundtrip() {
        let alert = FiredAlert {
            id: Uuid::nil(), rule_id: Uuid::nil(), tenant_id: Uuid::nil(),
            rule_name: "Test".into(), severity: "critical".into(),
            summary: "Something went wrong".into(),
            details: serde_json::json!({"key": "val"}), fired_at: 1700000000.0,
        };
        let json = serde_json::to_string(&alert).unwrap();
        let decoded: FiredAlert = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.rule_name, "Test");
        assert_eq!(decoded.details["key"], "val");
    }
}
