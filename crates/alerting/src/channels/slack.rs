use reqwest::Client;
use serde_json::{json, Value};

use super::SendResult;
use crate::engine::FiredAlert;

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

    let emoji = match alert.severity.as_str() {
        "critical" => ":rotating_light:",
        "warning" => ":warning:",
        _ => ":information_source:",
    };

    let mut blocks: Vec<Value> = vec![
        // Header
        json!({
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": format!("{} {} Alert: {}", emoji, alert.severity.to_uppercase(), alert.rule_name),
                "emoji": true
            }
        }),
        // Summary
        json!({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": alert.summary
            }
        }),
    ];

    // Detail fields from condition-specific details
    let fields = format_detail_fields(&alert.details);
    if !fields.is_empty() {
        blocks.push(json!({ "type": "divider" }));
        // Slack limits 10 fields per section
        for chunk in fields.chunks(10) {
            blocks.push(json!({
                "type": "section",
                "fields": chunk
            }));
        }
    }

    // Context: condition type + timestamp
    let mut context_elements = Vec::new();
    if let Some(ct) = &alert.condition_type {
        context_elements.push(json!({
            "type": "mrkdwn",
            "text": format!("Type: `{ct}`")
        }));
    }
    context_elements.push(json!({
        "type": "mrkdwn",
        "text": format!("Feloxi Alert Engine | <!date^{}^{{date_short_pretty}} {{time}}|{}>",
            alert.fired_at as i64,
            alert.fired_at as i64
        )
    }));
    blocks.push(json!({
        "type": "context",
        "elements": context_elements
    }));

    let payload = json!({
        "attachments": [{
            "color": color,
            "blocks": blocks
        }]
    });

    match client.post(webhook_url).json(&payload).send().await {
        Ok(resp) if resp.status().is_success() => SendResult::ok("slack"),
        Ok(resp) => SendResult::err("slack", format!("HTTP {}", resp.status())),
        Err(e) => SendResult::err("slack", e),
    }
}

fn format_detail_fields(details: &Value) -> Vec<Value> {
    let obj = match details.as_object() {
        Some(o) => o,
        None => return vec![],
    };

    obj.iter()
        .map(|(key, value)| {
            let label = snake_to_title(key);
            let display = format_value(key, value);
            json!({
                "type": "mrkdwn",
                "text": format!("*{label}*\n{display}")
            })
        })
        .collect()
}

fn snake_to_title(s: &str) -> String {
    s.split('_')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn format_value(key: &str, value: &Value) -> String {
    if let Some(n) = value.as_f64() {
        if key.contains("rate") {
            return format!("{:.1}%", n * 100.0);
        }
        if key.contains("seconds") || key.contains("runtime") || key.contains("latency") {
            return format!("{:.2}s", n);
        }
        if key.contains("factor") || key.contains("zscore") {
            return format!("{:.1}", n);
        }
        if n.fract() == 0.0 {
            return format!("{}", n as i64);
        }
        return format!("{:.2}", n);
    }
    if let Some(n) = value.as_u64() {
        return n.to_string();
    }
    if let Some(s) = value.as_str() {
        return s.to_string();
    }
    value.to_string()
}
