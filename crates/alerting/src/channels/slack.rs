use reqwest::Client;
use serde_json::json;

use crate::engine::FiredAlert;
use super::SendResult;

pub async fn send_slack_alert(
    client: &Client,
    webhook_url: &str,
    alert: &FiredAlert,
) -> SendResult {
    let color = match alert.severity.as_str() {
        "critical" => "#FF0000",
        "warning" => "#FFA500",
        _ => "#36A64F",
    };

    let payload = json!({
        "attachments": [{
            "color": color,
            "title": format!("🚨 {} Alert: {}", alert.severity.to_uppercase(), alert.rule_name),
            "text": alert.summary,
            "fields": [
                {
                    "title": "Severity",
                    "value": alert.severity,
                    "short": true
                },
                {
                    "title": "Rule",
                    "value": alert.rule_name,
                    "short": true
                }
            ],
            "footer": "Feloxi Alert Engine",
            "ts": alert.fired_at as i64
        }]
    });

    match client.post(webhook_url).json(&payload).send().await {
        Ok(resp) if resp.status().is_success() => SendResult::ok("slack"),
        Ok(resp) => SendResult::err("slack", format!("HTTP {}", resp.status())),
        Err(e) => SendResult::err("slack", e),
    }
}
