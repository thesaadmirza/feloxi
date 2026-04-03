use reqwest::Client;
use serde_json::json;
use std::collections::HashMap;

use super::SendResult;
use crate::engine::FiredAlert;

pub async fn send_webhook_alert(
    client: &Client,
    url: &str,
    headers: &Option<HashMap<String, String>>,
    alert: &FiredAlert,
) -> SendResult {
    let fired_at_iso = chrono::DateTime::from_timestamp(alert.fired_at as i64, 0)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|| alert.fired_at.to_string());

    let payload = json!({
        "alert_id": alert.id,
        "rule_name": alert.rule_name,
        "condition_type": alert.condition_type,
        "severity": alert.severity,
        "summary": alert.summary,
        "details": alert.details,
        "fired_at": fired_at_iso,
    });

    let mut req = client.post(url).json(&payload);

    if let Some(hdrs) = headers {
        for (key, value) in hdrs {
            req = req.header(key.as_str(), value.as_str());
        }
    }

    match req.send().await {
        Ok(resp) if resp.status().is_success() => SendResult::ok("webhook"),
        Ok(resp) => SendResult::err("webhook", format!("HTTP {}", resp.status())),
        Err(e) => SendResult::err("webhook", e),
    }
}
