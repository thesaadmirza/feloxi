use reqwest::Client;
use serde_json::{json, Value};

use super::SendResult;
use crate::engine::FiredAlert;

const PAGERDUTY_EVENTS_URL: &str = "https://events.pagerduty.com/v2/enqueue";

pub async fn send_pagerduty_alert(
    client: &Client,
    routing_key: &str,
    alert: &FiredAlert,
) -> SendResult {
    let payload = build_payload(routing_key, alert);

    match client.post(PAGERDUTY_EVENTS_URL).json(&payload).send().await {
        Ok(resp) if resp.status().is_success() => SendResult::ok("pagerduty"),
        Ok(resp) => SendResult::err("pagerduty", format!("HTTP {}", resp.status())),
        Err(e) => SendResult::err("pagerduty", e),
    }
}

/// Build the Events API v2 trigger for a fired alert.
pub(crate) fn build_payload(routing_key: &str, alert: &FiredAlert) -> Value {
    let severity = match alert.severity.as_str() {
        "critical" => "critical",
        "warning" => "warning",
        _ => "info",
    };

    let condition_type = alert.condition_type.as_deref().unwrap_or("alert");

    json!({
        "routing_key": routing_key,
        "event_action": "trigger",
        "payload": {
            "summary": alert.summary,
            "severity": severity,
            "source": "Feloxi",
            "component": alert.rule_name,
            "group": condition_type,
            "class": condition_type,
            "custom_details": alert.details,
        },
        "dedup_key": format!("fp-{}-{}", alert.rule_id, alert.tenant_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn alert() -> FiredAlert {
        FiredAlert {
            id: Uuid::nil(),
            rule_id: Uuid::nil(),
            tenant_id: Uuid::nil(),
            rule_name: "Workers offline".into(),
            condition_type: Some("worker_offline".into()),
            severity: "critical".into(),
            summary: "1 worker(s) went offline".into(),
            details: json!({ "workers_offline_count": 1 }),
            fired_at: 1_700_000_000.0,
        }
    }

    #[test]
    fn payload_maps_the_alert_onto_the_events_api() {
        let payload = build_payload("routing-key", &alert());
        assert_eq!(payload["payload"]["severity"], "critical");
        assert_eq!(payload["payload"]["component"], "Workers offline");
        assert_eq!(payload["payload"]["group"], "worker_offline");
        assert_eq!(payload["payload"]["custom_details"]["workers_offline_count"], 1);
        assert_eq!(
            payload["dedup_key"],
            "fp-00000000-0000-0000-0000-000000000000-00000000-0000-0000-0000-000000000000"
        );
    }
}
