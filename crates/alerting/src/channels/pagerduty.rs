use reqwest::Client;
use serde_json::json;

use super::SendResult;
use crate::engine::FiredAlert;

const PAGERDUTY_EVENTS_URL: &str = "https://events.pagerduty.com/v2/enqueue";

pub async fn send_pagerduty_alert(
    client: &Client,
    routing_key: &str,
    alert: &FiredAlert,
) -> SendResult {
    let severity = match alert.severity.as_str() {
        "critical" => "critical",
        "warning" => "warning",
        _ => "info",
    };

    let condition_type = alert.condition_type.as_deref().unwrap_or("alert");

    let payload = json!({
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
    });

    match client.post(PAGERDUTY_EVENTS_URL).json(&payload).send().await {
        Ok(resp) if resp.status().is_success() => SendResult::ok("pagerduty"),
        Ok(resp) => SendResult::err("pagerduty", format!("HTTP {}", resp.status())),
        Err(e) => SendResult::err("pagerduty", e),
    }
}
