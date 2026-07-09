//! Pure math for the anomaly and spike alert conditions. Kept free of any
//! database types so the guards (sample minimums, stddev floors) are unit
//! testable.

use common::BeatScheduleEntry;

/// Minimum runtime samples in the current window before a latency z-score is
/// computed. Below this an average is too noisy to call an anomaly.
pub const MIN_CURRENT_SAMPLES: u64 = 3;
/// Minimum baseline runtime samples before a latency z-score is computed.
pub const MIN_BASELINE_SAMPLES: u64 = 20;
/// Minimum tasks in the current window before an error-rate spike is
/// computed (1 failure out of 2 tasks is not a 25x spike).
pub const MIN_SPIKE_SAMPLES: u64 = 5;
/// Cap on the reported spike factor when the baseline error rate is zero.
pub const SPIKE_FACTOR_CAP: f64 = 999.0;
/// How long past `next_run_at` a beat schedule may run before counting as
/// missed. Matches the Beat page's "Missed" badge tolerance.
pub const BEAT_TOLERANCE_SECS: f64 = 60.0;

/// A z-score together with the display values that go into alert summaries.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct ZScore {
    pub zscore: f64,
    pub current: f64,
    pub baseline_mean: f64,
}

/// Z-score of the current bucket count against per-bucket moments, treating
/// the `n_total - buckets_present` absent buckets as zeros. The stddev is
/// floored at the Poisson noise level (`sqrt(mean)`, min 1.0) so a perfectly
/// flat baseline doesn't turn a one-task wiggle into an infinite z.
pub fn throughput_zscore(current: f64, bucket_sum: f64, bucket_sumsq: f64, n_total: f64) -> ZScore {
    if n_total < 1.0 {
        return ZScore { zscore: 0.0, current, baseline_mean: 0.0 };
    }
    let mean = bucket_sum / n_total;
    let var = (bucket_sumsq / n_total - mean * mean).max(0.0);
    let std = var.sqrt().max(mean.sqrt()).max(1.0);
    ZScore { zscore: (current - mean) / std, current, baseline_mean: mean }
}

/// Z-score of the current average latency against the baseline distribution.
/// Returns zero (never fires) when either side lacks samples. The stddev is
/// floored at 5% of the baseline mean so ultra-stable runtimes don't fire on
/// millisecond jitter.
pub fn latency_zscore(
    current_avg: f64,
    current_samples: u64,
    baseline_avg: f64,
    baseline_std: f64,
    baseline_samples: u64,
) -> ZScore {
    if current_samples < MIN_CURRENT_SAMPLES || baseline_samples < MIN_BASELINE_SAMPLES {
        return ZScore::default();
    }
    if !current_avg.is_finite() || !baseline_avg.is_finite() {
        return ZScore::default();
    }
    let std = baseline_std.max(baseline_avg.abs() * 0.05).max(1e-3);
    ZScore {
        zscore: (current_avg - baseline_avg) / std,
        current: current_avg,
        baseline_mean: baseline_avg,
    }
}

/// An error-rate spike factor with the rates that go into alert summaries.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Spike {
    pub factor: f64,
    pub current_rate: f64,
    pub baseline_rate: f64,
}

/// Ratio of the current failure rate to the baseline failure rate. The
/// baseline rate is floored at half a failure over the baseline count
/// (Laplace-style) so a clean history doesn't make the first failure an
/// infinite spike; with no baseline data at all, any current failure reports
/// the capped factor.
pub fn error_spike_factor(
    current_total: u64,
    current_failures: u64,
    baseline_total: u64,
    baseline_failures: u64,
) -> Spike {
    if current_total < MIN_SPIKE_SAMPLES {
        return Spike::default();
    }
    let current_rate = current_failures as f64 / current_total as f64;
    if baseline_total == 0 {
        let factor = if current_failures > 0 { SPIKE_FACTOR_CAP } else { 0.0 };
        return Spike { factor, current_rate, baseline_rate: 0.0 };
    }
    let baseline_rate = baseline_failures as f64 / baseline_total as f64;
    let effective = baseline_rate.max(0.5 / baseline_total as f64);
    Spike { factor: (current_rate / effective).min(SPIKE_FACTOR_CAP), current_rate, baseline_rate }
}

/// Normalize a rule's task-duration percentile to a quantile level in (0, 1).
/// The UI sends fractions (0.95) but older clients may send percents (95).
pub fn normalize_percentile(p: f64) -> f64 {
    let p = if p > 1.0 { p / 100.0 } else { p };
    if !p.is_finite() || p <= 0.0 {
        0.95
    } else {
        p.clamp(0.5, 0.999)
    }
}

/// Count beat schedules that are past `next_run_at` by more than the
/// tolerance. `filter` narrows to one schedule name; `*` or empty matches all.
/// Entries without a `next_run_at` can't be judged and never count as missed.
pub fn count_missed_schedules(entries: &[BeatScheduleEntry], filter: &str, now: f64) -> u32 {
    entries
        .iter()
        .filter(|e| filter.is_empty() || filter == "*" || e.schedule_name == filter)
        .filter(|e| e.next_run_at.is_some_and(|next| now - next > BEAT_TOLERANCE_SECS))
        .count() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throughput_zscore_flags_a_drop_to_zero() {
        // 24h of 10-min buckets averaging 600 tasks each, current bucket empty.
        let n = 144.0;
        let z = throughput_zscore(0.0, 600.0 * n, 600.0 * 600.0 * n, n);
        assert_eq!(z.baseline_mean, 600.0);
        // Flat baseline -> std floored at sqrt(600) ~ 24.5 -> z ~ -24.5
        assert!(z.zscore < -20.0, "zscore was {}", z.zscore);
    }

    #[test]
    fn throughput_zscore_quiet_on_flat_baseline_wiggle() {
        let n = 144.0;
        let z = throughput_zscore(9.0, 10.0 * n, 100.0 * n, n);
        // One task below a flat mean of 10 is within Poisson noise.
        assert!(z.zscore.abs() < 1.0, "zscore was {}", z.zscore);
    }

    #[test]
    fn throughput_zscore_empty_baseline_is_zero() {
        let z = throughput_zscore(50.0, 0.0, 0.0, 0.0);
        assert_eq!(z.zscore, 0.0);
    }

    #[test]
    fn latency_zscore_needs_samples() {
        assert_eq!(latency_zscore(10.0, 2, 1.0, 0.1, 1000,).zscore, 0.0);
        assert_eq!(latency_zscore(10.0, 100, 1.0, 0.1, 10).zscore, 0.0);
    }

    #[test]
    fn latency_zscore_detects_regression() {
        let z = latency_zscore(2.0, 50, 1.0, 0.1, 1000);
        assert!((z.zscore - 10.0).abs() < 1e-9, "zscore was {}", z.zscore);
        assert_eq!(z.current, 2.0);
        assert_eq!(z.baseline_mean, 1.0);
    }

    #[test]
    fn latency_zscore_floors_tiny_stddev() {
        // Baseline std of 1µs would make any jitter a huge z; floor is 5% of mean.
        let z = latency_zscore(1.04, 50, 1.0, 0.000001, 1000);
        assert!(z.zscore < 1.0, "zscore was {}", z.zscore);
    }

    #[test]
    fn spike_factor_detects_tenfold_jump() {
        // Baseline 1% over 10k tasks, current 10% over 100 tasks.
        let s = error_spike_factor(100, 10, 10_000, 100);
        assert!((s.factor - 10.0).abs() < 1e-9, "factor was {}", s.factor);
        assert_eq!(s.current_rate, 0.1);
        assert_eq!(s.baseline_rate, 0.01);
    }

    #[test]
    fn spike_factor_ignores_tiny_windows() {
        assert_eq!(error_spike_factor(2, 1, 10_000, 100).factor, 0.0);
    }

    #[test]
    fn spike_factor_clean_baseline_is_floored_not_infinite() {
        // No baseline failures over 1000 tasks: floor at 0.5/1000.
        let s = error_spike_factor(100, 10, 1000, 0);
        assert!((s.factor - 200.0).abs() < 1e-9, "factor was {}", s.factor);
    }

    #[test]
    fn spike_factor_no_baseline_data() {
        assert_eq!(error_spike_factor(100, 10, 0, 0).factor, SPIKE_FACTOR_CAP);
        assert_eq!(error_spike_factor(100, 0, 0, 0).factor, 0.0);
    }

    #[test]
    fn percentile_normalization() {
        assert_eq!(normalize_percentile(0.95), 0.95);
        assert_eq!(normalize_percentile(95.0), 0.95);
        assert_eq!(normalize_percentile(99.9), 0.999);
        assert_eq!(normalize_percentile(0.0), 0.95);
        assert_eq!(normalize_percentile(f64::NAN), 0.95);
        assert_eq!(normalize_percentile(0.2), 0.5);
    }

    fn entry(name: &str, next_run_at: Option<f64>) -> BeatScheduleEntry {
        BeatScheduleEntry {
            schedule_name: name.into(),
            task_name: format!("tasks.{name}"),
            last_run_at: None,
            next_run_at,
        }
    }

    #[test]
    fn beat_missed_counts_overdue_schedules() {
        let now = 10_000.0;
        let entries = vec![
            entry("on-time", Some(now - 30.0)), // within tolerance
            entry("late", Some(now - 120.0)),   // missed
            entry("future", Some(now + 300.0)), // not due yet
            entry("unknown", None),             // can't judge
        ];
        assert_eq!(count_missed_schedules(&entries, "*", now), 1);
        assert_eq!(count_missed_schedules(&entries, "", now), 1);
        assert_eq!(count_missed_schedules(&entries, "late", now), 1);
        assert_eq!(count_missed_schedules(&entries, "on-time", now), 0);
        assert_eq!(count_missed_schedules(&entries, "nope", now), 0);
    }
}
