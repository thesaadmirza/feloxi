use reqwest::Client;
use serde_json::{json, Value};

use super::SendResult;
use crate::engine::FiredAlert;

// Discord embed limits (https://discord.com/developers/docs/resources/message).
const MAX_FIELDS: usize = 25;
const MAX_TITLE: usize = 256;
const MAX_DESC: usize = 4096;
const MAX_FIELD_VALUE: usize = 1024;

/// Send an alert to a Discord channel via an incoming webhook URL.
///
/// Builds an embed (color is a decimal int, fields truncated to Discord's
/// limits, description never empty). A deleted webhook returns HTTP 404 with
/// error `code: 10015`; a 429's `retry_after` (seconds) is captured on the
/// result for a future retry queue to honor.
pub async fn send_discord_alert(
    client: &Client,
    webhook_url: &str,
    alert: &FiredAlert,
) -> SendResult {
    let payload = json!({ "embeds": [build_embed(alert)] });

    let resp = match client.post(webhook_url).json(&payload).send().await {
        Ok(r) => r,
        // The webhook URL is the secret — strip it from the error string.
        Err(e) => return SendResult::err("discord", e.without_url()),
    };

    let status = resp.status().as_u16();
    if resp.status().is_success() {
        return SendResult::ok("discord").with_status(status);
    }

    // Rate limited: prefer the body's `retry_after`, fall back to the header.
    if status == 429 {
        let header_ra = resp
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<f64>().ok());
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        let retry_after =
            body.get("retry_after").and_then(|v| v.as_f64()).or(header_ra).unwrap_or(1.0);
        return SendResult::err("discord", "rate limited")
            .with_status(status)
            .with_retry_after(retry_after);
    }

    // Deleted/invalid webhook → mark the integration revoked.
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    let code = body.get("code").and_then(|v| v.as_i64());
    let msg = body
        .get("message")
        .and_then(|v| v.as_str())
        .map(|m| format!("HTTP {status}: {m}"))
        .unwrap_or_else(|| format!("HTTP {status}"));
    let mut result = SendResult::err("discord", msg).with_status(status);
    if status == 404 || code == Some(10015) {
        // The dispatch layer treats a 404/10015 as "revoked".
        result.status = Some(404);
    }
    result
}

/// Whether a Discord send result indicates the webhook no longer exists.
pub fn is_webhook_revoked(result: &SendResult) -> bool {
    result.status == Some(404)
}

fn build_embed(alert: &FiredAlert) -> Value {
    let color: u32 = match alert.severity.as_str() {
        "critical" => 0xFF_0000,
        "warning" => 0xFF_A500,
        _ => 0x36_A64F,
    };

    let title =
        truncate(&format!("[{}] {}", alert.severity.to_uppercase(), alert.rule_name), MAX_TITLE);
    // Description must be non-empty — Discord rejects an empty embed.
    let description = {
        let s = alert.summary.trim();
        let base = if s.is_empty() { alert.rule_name.as_str() } else { s };
        truncate(base, MAX_DESC)
    };

    let mut fields: Vec<Value> = Vec::new();
    if let Some(obj) = alert.details.as_object() {
        for (key, value) in obj.iter().take(MAX_FIELDS) {
            fields.push(json!({
                "name": truncate(&super::snake_to_title(key), MAX_TITLE),
                "value": truncate(&value_to_string(value), MAX_FIELD_VALUE),
                "inline": true,
            }));
        }
    }
    if let Some(ct) = &alert.condition_type {
        if fields.len() < MAX_FIELDS {
            fields.push(
                json!({ "name": "Type", "value": truncate(ct, MAX_FIELD_VALUE), "inline": true }),
            );
        }
    }

    json!({
        "title": title,
        "description": description,
        "color": color,
        "fields": fields,
        "footer": { "text": "Feloxi Alert Engine" },
        "timestamp": chrono::DateTime::from_timestamp(alert.fired_at as i64, 0)
            .unwrap_or_else(chrono::Utc::now)
            .to_rfc3339(),
    })
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max.saturating_sub(1)).collect::<String>() + "…"
    }
}

fn value_to_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}
