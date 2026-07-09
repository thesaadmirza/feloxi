//! Alert incident recovery and delivery retry policy.
//!
//! Recovery: a firing rule becomes an open incident; it resolves only after
//! the condition evaluates clear for [`CLEAR_STREAK_TO_RESOLVE`] consecutive
//! passes, so a metric hovering at the threshold doesn't ping-pong
//! fired/resolved notifications.
//!
//! Retry: transient delivery failures are retried on a fixed backoff, honoring
//! a provider's Retry-After when it gave one.

use std::collections::HashMap;

use uuid::Uuid;

use crate::channels::SendResult;

/// Consecutive clear evaluations (at the 60s cadence) before an open incident
/// resolves.
pub const CLEAR_STREAK_TO_RESOLVE: u32 = 2;

/// Delivery attempts per channel per incident, including the initial send.
pub const MAX_DELIVERY_ATTEMPTS: u32 = 3;

/// Tracks consecutive clear evaluations for open incidents. In-memory: a
/// restart just delays a resolve by the streak length (two passes).
#[derive(Default)]
pub struct ResolveTracker {
    clear_streaks: HashMap<Uuid, u32>,
}

impl ResolveTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// The rule fired (or has an open incident and is still firing): any clear
    /// streak is broken.
    pub fn record_firing(&mut self, rule_id: Uuid) {
        self.clear_streaks.remove(&rule_id);
    }

    /// The rule has an open incident but evaluated clear. Returns true when
    /// the streak reaches the resolve threshold.
    pub fn record_clear(&mut self, rule_id: Uuid) -> bool {
        let streak = self.clear_streaks.entry(rule_id).or_insert(0);
        *streak += 1;
        *streak >= CLEAR_STREAK_TO_RESOLVE
    }

    /// Forget a rule once its incident is resolved (or the rule disappeared).
    pub fn forget(&mut self, rule_id: Uuid) {
        self.clear_streaks.remove(&rule_id);
    }
}

/// Severity rank for channel routing: info < warning < critical. Unknown
/// strings rank as info. "resolved" notices are routed by the incident's fire
/// severity, not their own.
pub fn severity_rank(severity: &str) -> u8 {
    match severity {
        "critical" => 2,
        "warning" => 1,
        _ => 0,
    }
}

/// Whether a channel with the given severity floor accepts an alert of
/// `severity`. No floor accepts everything.
pub fn channel_accepts(min_severity: Option<&str>, severity: &str) -> bool {
    match min_severity {
        None => true,
        Some(min) => severity_rank(severity) >= severity_rank(min),
    }
}

/// Whether a failed delivery is worth retrying: network errors (no status),
/// server errors, and rate limits. Client errors (bad webhook, revoked token,
/// missing integration) won't get better on their own.
pub fn is_retryable(result: &SendResult) -> bool {
    if result.success {
        return false;
    }
    match result.status {
        None => true,
        Some(429) => true,
        Some(s) => s >= 500,
    }
}

/// Seconds until the next attempt. `attempt` is the one that just failed
/// (1-based). A provider Retry-After wins when longer.
pub fn backoff_secs(attempt: u32, retry_after: Option<f64>) -> f64 {
    let base = match attempt {
        1 => 60.0,
        2 => 300.0,
        _ => 900.0,
    };
    match retry_after {
        Some(ra) if ra.is_finite() && ra > base => ra.min(3600.0),
        _ => base,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_needs_consecutive_clears() {
        let mut tracker = ResolveTracker::new();
        let rule = Uuid::new_v4();

        assert!(!tracker.record_clear(rule));
        assert!(tracker.record_clear(rule));
    }

    #[test]
    fn firing_breaks_the_streak() {
        let mut tracker = ResolveTracker::new();
        let rule = Uuid::new_v4();

        assert!(!tracker.record_clear(rule));
        tracker.record_firing(rule);
        assert!(!tracker.record_clear(rule));
        assert!(tracker.record_clear(rule));
    }

    #[test]
    fn rules_tracked_independently() {
        let mut tracker = ResolveTracker::new();
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();

        assert!(!tracker.record_clear(a));
        assert!(!tracker.record_clear(b));
        assert!(tracker.record_clear(a));
    }

    #[test]
    fn retryable_classification() {
        let ok = SendResult::ok("slack");
        assert!(!is_retryable(&ok));

        let mut network = SendResult::err("slack", "connection refused");
        network.status = None;
        assert!(is_retryable(&network));

        let mut rate_limited = SendResult::err("slack", "rate limited");
        rate_limited.status = Some(429);
        assert!(is_retryable(&rate_limited));

        let mut server = SendResult::err("webhook", "bad gateway");
        server.status = Some(502);
        assert!(is_retryable(&server));

        let mut revoked = SendResult::err("discord", "unknown webhook");
        revoked.status = Some(404);
        assert!(!is_retryable(&revoked));

        let mut bad_request = SendResult::err("pagerduty", "invalid key");
        bad_request.status = Some(400);
        assert!(!is_retryable(&bad_request));
    }

    #[test]
    fn severity_routing() {
        assert!(channel_accepts(None, "info"));
        assert!(channel_accepts(None, "critical"));
        assert!(channel_accepts(Some("warning"), "critical"));
        assert!(channel_accepts(Some("warning"), "warning"));
        assert!(!channel_accepts(Some("warning"), "info"));
        assert!(!channel_accepts(Some("critical"), "warning"));
        // Unknown severities rank lowest on both sides.
        assert!(channel_accepts(Some("bogus"), "info"));
        assert!(!channel_accepts(Some("critical"), "bogus"));
    }

    #[test]
    fn backoff_schedule_and_retry_after() {
        assert_eq!(backoff_secs(1, None), 60.0);
        assert_eq!(backoff_secs(2, None), 300.0);
        assert_eq!(backoff_secs(3, None), 900.0);
        // Retry-After wins only when longer, capped at an hour.
        assert_eq!(backoff_secs(1, Some(120.0)), 120.0);
        assert_eq!(backoff_secs(1, Some(30.0)), 60.0);
        assert_eq!(backoff_secs(1, Some(90_000.0)), 3600.0);
        assert_eq!(backoff_secs(1, Some(f64::NAN)), 60.0);
    }
}
