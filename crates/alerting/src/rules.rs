use serde::{Deserialize, Serialize};

// Re-export from db where the canonical definitions live (with ToSchema).
pub use db::postgres::models::{AlertChannel, AlertCondition};

/// Fully resolved alert rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedAlertRule {
    pub id: uuid::Uuid,
    pub tenant_id: uuid::Uuid,
    pub name: String,
    pub condition: AlertCondition,
    pub channels: Vec<AlertChannel>,
    pub cooldown_secs: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    // ─── AlertCondition serde roundtrips ───────────────────────

    #[test]
    fn condition_task_failure_rate_serde() {
        let cond = AlertCondition::TaskFailureRate {
            threshold: 0.15,
            window_minutes: 10,
            task_name: "tasks.process".into(),
        };
        let json = serde_json::to_string(&cond).unwrap();
        assert!(json.contains("\"type\":\"task_failure_rate\""));
        let decoded: AlertCondition = serde_json::from_str(&json).unwrap();
        match decoded {
            AlertCondition::TaskFailureRate {
                threshold,
                window_minutes,
                task_name,
            } => {
                assert!((threshold - 0.15).abs() < f64::EPSILON);
                assert_eq!(window_minutes, 10);
                assert_eq!(task_name, "tasks.process");
            }
            _ => panic!("Wrong variant"),
        }
    }

    #[test]
    fn condition_queue_depth_serde() {
        let cond = AlertCondition::QueueDepth {
            threshold: 1000,
            queue: "default".into(),
        };
        let json = serde_json::to_string(&cond).unwrap();
        assert!(json.contains("\"type\":\"queue_depth\""));
        let decoded: AlertCondition = serde_json::from_str(&json).unwrap();
        match decoded {
            AlertCondition::QueueDepth { threshold, queue } => {
                assert_eq!(threshold, 1000);
                assert_eq!(queue, "default");
            }
            _ => panic!("Wrong variant"),
        }
    }

    #[test]
    fn condition_worker_offline_serde() {
        let cond = AlertCondition::WorkerOffline {
            grace_period_seconds: 120,
        };
        let json = serde_json::to_string(&cond).unwrap();
        assert!(json.contains("\"type\":\"worker_offline\""));
        let decoded: AlertCondition = serde_json::from_str(&json).unwrap();
        match decoded {
            AlertCondition::WorkerOffline {
                grace_period_seconds,
            } => {
                assert_eq!(grace_period_seconds, 120);
            }
            _ => panic!("Wrong variant"),
        }
    }

    #[test]
    fn condition_task_duration_serde() {
        let cond = AlertCondition::TaskDuration {
            threshold_seconds: 30.0,
            percentile: 95.0,
            task_name: "tasks.heavy".into(),
        };
        let json = serde_json::to_string(&cond).unwrap();
        assert!(json.contains("\"type\":\"task_duration\""));
        let decoded: AlertCondition = serde_json::from_str(&json).unwrap();
        match decoded {
            AlertCondition::TaskDuration {
                threshold_seconds,
                percentile,
                task_name,
            } => {
                assert!((threshold_seconds - 30.0).abs() < f64::EPSILON);
                assert!((percentile - 95.0).abs() < f64::EPSILON);
                assert_eq!(task_name, "tasks.heavy");
            }
            _ => panic!("Wrong variant"),
        }
    }

    #[test]
    fn condition_beat_missed_serde() {
        let cond = AlertCondition::BeatMissed {
            schedule_name: "cleanup".into(),
        };
        let json = serde_json::to_string(&cond).unwrap();
        assert!(json.contains("\"type\":\"beat_missed\""));
        let decoded: AlertCondition = serde_json::from_str(&json).unwrap();
        match decoded {
            AlertCondition::BeatMissed { schedule_name } => {
                assert_eq!(schedule_name, "cleanup");
            }
            _ => panic!("Wrong variant"),
        }
    }

    #[test]
    fn condition_task_failed_serde() {
        let cond = AlertCondition::TaskFailed {
            task_name: "tasks.payment".into(),
        };
        let json = serde_json::to_string(&cond).unwrap();
        assert!(json.contains("\"type\":\"task_failed\""));
        let decoded: AlertCondition = serde_json::from_str(&json).unwrap();
        match decoded {
            AlertCondition::TaskFailed { task_name } => {
                assert_eq!(task_name, "tasks.payment");
            }
            _ => panic!("Wrong variant"),
        }
    }

    #[test]
    fn condition_no_events_serde() {
        let cond = AlertCondition::NoEvents {
            silence_minutes: 15,
        };
        let json = serde_json::to_string(&cond).unwrap();
        assert!(json.contains("\"type\":\"no_events\""));
        let decoded: AlertCondition = serde_json::from_str(&json).unwrap();
        match decoded {
            AlertCondition::NoEvents { silence_minutes } => {
                assert_eq!(silence_minutes, 15);
            }
            _ => panic!("Wrong variant"),
        }
    }

    // ─── AlertChannel serde ────────────────────────────────────

    #[test]
    fn channel_slack_serde() {
        let ch = AlertChannel::Slack {
            webhook_url: "https://hooks.slack.com/services/x".into(),
        };
        let json = serde_json::to_string(&ch).unwrap();
        assert!(json.contains("\"type\":\"slack\""));
        let decoded: AlertChannel = serde_json::from_str(&json).unwrap();
        match decoded {
            AlertChannel::Slack { webhook_url } => {
                assert_eq!(webhook_url, "https://hooks.slack.com/services/x");
            }
            _ => panic!("Wrong variant"),
        }
    }

    #[test]
    fn channel_email_serde() {
        let ch = AlertChannel::Email {
            to: vec!["a@b.com".into(), "c@d.com".into()],
        };
        let json = serde_json::to_string(&ch).unwrap();
        assert!(json.contains("\"type\":\"email\""));
        let decoded: AlertChannel = serde_json::from_str(&json).unwrap();
        match decoded {
            AlertChannel::Email { to } => {
                assert_eq!(to.len(), 2);
                assert_eq!(to[0], "a@b.com");
            }
            _ => panic!("Wrong variant"),
        }
    }

    #[test]
    fn channel_webhook_serde() {
        let mut headers = HashMap::new();
        headers.insert("Authorization".into(), "Bearer token".into());
        let ch = AlertChannel::Webhook {
            url: "https://example.com/hook".into(),
            headers: Some(headers),
        };
        let json = serde_json::to_string(&ch).unwrap();
        assert!(json.contains("\"type\":\"webhook\""));
        let decoded: AlertChannel = serde_json::from_str(&json).unwrap();
        match decoded {
            AlertChannel::Webhook { url, headers } => {
                assert_eq!(url, "https://example.com/hook");
                assert_eq!(
                    headers.unwrap().get("Authorization").unwrap(),
                    "Bearer token"
                );
            }
            _ => panic!("Wrong variant"),
        }
    }

    #[test]
    fn channel_webhook_no_headers() {
        let ch = AlertChannel::Webhook {
            url: "https://example.com".into(),
            headers: None,
        };
        let json = serde_json::to_string(&ch).unwrap();
        let decoded: AlertChannel = serde_json::from_str(&json).unwrap();
        match decoded {
            AlertChannel::Webhook { headers, .. } => {
                assert!(headers.is_none());
            }
            _ => panic!("Wrong variant"),
        }
    }

    #[test]
    fn channel_pagerduty_serde() {
        let ch = AlertChannel::PagerDuty {
            routing_key: "abc123".into(),
        };
        let json = serde_json::to_string(&ch).unwrap();
        assert!(json.contains("\"type\":\"pagerduty\""));
        let decoded: AlertChannel = serde_json::from_str(&json).unwrap();
        match decoded {
            AlertChannel::PagerDuty { routing_key } => {
                assert_eq!(routing_key, "abc123");
            }
            _ => panic!("Wrong variant"),
        }
    }

    // ─── ResolvedAlertRule serde ───────────────────────────────

    #[test]
    fn resolved_alert_rule_serde_roundtrip() {
        let rule = ResolvedAlertRule {
            id: uuid::Uuid::nil(),
            tenant_id: uuid::Uuid::nil(),
            name: "High failure rate".into(),
            condition: AlertCondition::TaskFailureRate {
                threshold: 0.5,
                window_minutes: 5,
                task_name: "*".into(),
            },
            channels: vec![
                AlertChannel::Slack {
                    webhook_url: "https://hook".into(),
                },
                AlertChannel::Email {
                    to: vec!["admin@co.com".into()],
                },
            ],
            cooldown_secs: 300,
        };
        let json = serde_json::to_string(&rule).unwrap();
        let decoded: ResolvedAlertRule = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.name, "High failure rate");
        assert_eq!(decoded.channels.len(), 2);
        assert_eq!(decoded.cooldown_secs, 300);
    }
}
