use std::collections::HashMap;
use std::time::{Duration, Instant};
use uuid::Uuid;

/// In-memory throttle for alert de-duplication.
/// Prevents the same alert from firing repeatedly within the cooldown window.
pub struct AlertThrottle {
    last_fired: HashMap<Uuid, Instant>,
}

impl AlertThrottle {
    pub fn new() -> Self {
        Self {
            last_fired: HashMap::new(),
        }
    }

    /// Check if an alert rule is currently throttled.
    pub fn is_throttled(&self, rule_id: Uuid, cooldown: Duration) -> bool {
        self.last_fired
            .get(&rule_id)
            .map(|last| last.elapsed() < cooldown)
            .unwrap_or(false)
    }

    /// Record that an alert was fired.
    pub fn record_fired(&mut self, rule_id: Uuid) {
        self.last_fired.insert(rule_id, Instant::now());
    }

    /// Clean up expired entries.
    pub fn cleanup(&mut self, max_cooldown: Duration) {
        self.last_fired
            .retain(|_, instant| instant.elapsed() < max_cooldown);
    }
}

impl Default for AlertThrottle {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn is_throttled_after_firing() {
        let mut throttle = AlertThrottle::new();
        let rule_id = Uuid::new_v4();

        throttle.record_fired(rule_id);
        assert!(throttle.is_throttled(rule_id, Duration::from_secs(60)));
    }

    #[test]
    fn different_rules_independent() {
        let mut throttle = AlertThrottle::new();
        let rule_a = Uuid::new_v4();
        let rule_b = Uuid::new_v4();

        throttle.record_fired(rule_a);
        assert!(throttle.is_throttled(rule_a, Duration::from_secs(60)));
        assert!(!throttle.is_throttled(rule_b, Duration::from_secs(60)));
    }

    #[test]
    fn not_throttled_after_cooldown_expires() {
        let mut throttle = AlertThrottle::new();
        let rule_id = Uuid::new_v4();

        throttle.record_fired(rule_id);

        // Use a very short cooldown
        assert!(throttle.is_throttled(rule_id, Duration::from_millis(100)));

        // Wait for cooldown to expire
        thread::sleep(Duration::from_millis(150));
        assert!(!throttle.is_throttled(rule_id, Duration::from_millis(100)));
    }

    #[test]
    fn record_fired_updates_timestamp() {
        let mut throttle = AlertThrottle::new();
        let rule_id = Uuid::new_v4();

        throttle.record_fired(rule_id);
        thread::sleep(Duration::from_millis(50));

        // Fire again - should reset the clock
        throttle.record_fired(rule_id);
        assert!(throttle.is_throttled(rule_id, Duration::from_millis(100)));
    }

    #[test]
    fn cleanup_removes_expired_entries() {
        let mut throttle = AlertThrottle::new();
        let rule_a = Uuid::new_v4();
        let rule_b = Uuid::new_v4();

        throttle.record_fired(rule_a);
        throttle.record_fired(rule_b);

        // Wait a bit
        thread::sleep(Duration::from_millis(50));

        // Cleanup with a short max_cooldown should remove both
        throttle.cleanup(Duration::from_millis(10));

        // Both should be cleaned up since they're older than 10ms
        assert!(!throttle.is_throttled(rule_a, Duration::from_secs(60)));
        assert!(!throttle.is_throttled(rule_b, Duration::from_secs(60)));
    }

    #[test]
    fn cleanup_keeps_recent_entries() {
        let mut throttle = AlertThrottle::new();
        let rule_id = Uuid::new_v4();

        throttle.record_fired(rule_id);

        // Cleanup with a long max_cooldown should keep the entry
        throttle.cleanup(Duration::from_secs(300));
        assert!(throttle.is_throttled(rule_id, Duration::from_secs(60)));
    }

    #[test]
    fn multiple_rules_all_throttled() {
        let mut throttle = AlertThrottle::new();
        let rules: Vec<Uuid> = (0..5).map(|_| Uuid::new_v4()).collect();

        for &rule_id in &rules {
            throttle.record_fired(rule_id);
        }

        for &rule_id in &rules {
            assert!(throttle.is_throttled(rule_id, Duration::from_secs(60)));
        }
    }

    #[test]
    fn unknown_rule_not_throttled() {
        let throttle = AlertThrottle::new();
        assert!(!throttle.is_throttled(Uuid::nil(), Duration::from_secs(60)));
        assert!(!throttle.is_throttled(Uuid::new_v4(), Duration::from_secs(3600)));
    }
}
