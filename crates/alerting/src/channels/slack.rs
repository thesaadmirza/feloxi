use reqwest::Client;
use serde_json::{json, Value};

use super::SendResult;
use crate::engine::FiredAlert;
use crate::tenant::AlertTenant;

pub async fn send_slack_alert(
    client: &Client,
    webhook_url: &str,
    alert: &FiredAlert,
    tenant: &AlertTenant,
) -> SendResult {
    let payload = json!({
        "attachments": [{
            "color": severity_color(alert),
            "blocks": build_blocks(alert, tenant)
        }]
    });

    match client.post(webhook_url).json(&payload).send().await {
        Ok(resp) if resp.status().is_success() => SendResult::ok("slack"),
        Ok(resp) => SendResult::err("slack", format!("HTTP {}", resp.status())),
        // The incoming-webhook URL is a secret — strip it from the error.
        Err(e) => SendResult::err("slack", e.without_url()),
    }
}

/// Slack attachment color for an alert's severity.
pub(crate) fn severity_color(alert: &FiredAlert) -> &'static str {
    match alert.severity.as_str() {
        "critical" => "#FF0000",
        "warning" => "#FFA500",
        _ => "#36A64F",
    }
}

/// Plain-text fallback (notification/accessibility text) for an alert. This is
/// what a mobile push preview shows, so it leads with the tenant.
pub(crate) fn fallback_text(alert: &FiredAlert, tenant: &AlertTenant) -> String {
    format!(
        "[{}] [{}] {}: {}",
        tenant.name,
        alert.severity.to_uppercase(),
        alert.rule_name,
        alert.summary
    )
}

/// Build the Block Kit blocks for an alert. Shared between the incoming-webhook
/// sender and the bot-token (`chat.postMessage`) sender. Capped at 50 blocks
/// (Slack's per-message limit).
pub(crate) fn build_blocks(alert: &FiredAlert, tenant: &AlertTenant) -> Vec<Value> {
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

    // Context: tenant + condition type + timestamp
    let mut context_elements = vec![json!({
        "type": "mrkdwn",
        "text": format!("Tenant: *{}*", mrkdwn_escape(&tenant.name))
    })];
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

    // Slack rejects messages with more than 50 blocks.
    blocks.truncate(50);
    blocks
}

/// Escape the three characters Slack reserves in message text.
fn mrkdwn_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn format_detail_fields(details: &Value) -> Vec<Value> {
    let obj = match details.as_object() {
        Some(o) => o,
        None => return vec![],
    };

    obj.iter()
        .map(|(key, value)| {
            let label = super::snake_to_title(key);
            let display = format_value(key, value);
            json!({
                "type": "mrkdwn",
                "text": format!("*{label}*\n{display}")
            })
        })
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn fixtures() -> (FiredAlert, AlertTenant) {
        let alert = FiredAlert {
            id: Uuid::nil(),
            rule_id: Uuid::nil(),
            tenant_id: Uuid::nil(),
            rule_name: "Workers offline".into(),
            condition_type: Some("worker_offline".into()),
            severity: "critical".into(),
            summary: "1 worker(s) went offline".into(),
            details: json!({ "workers_offline_count": 1 }),
            fired_at: 1_700_000_000.0,
        };
        let tenant =
            AlertTenant { id: Uuid::nil(), name: "Acme Payments".into(), slug: "acme".into() };
        (alert, tenant)
    }

    #[test]
    fn context_block_names_the_tenant() {
        let (alert, tenant) = fixtures();
        let blocks = build_blocks(&alert, &tenant);
        let context = blocks.last().expect("context block");
        assert_eq!(context["type"], "context");
        assert_eq!(context["elements"][0]["text"], "Tenant: *Acme Payments*");
        // The condition type and timestamp elements are still there.
        assert_eq!(context["elements"][1]["text"], "Type: `worker_offline`");
        assert!(context["elements"][2]["text"].as_str().unwrap().contains("Feloxi Alert Engine"));
    }

    #[test]
    fn fallback_text_leads_with_the_tenant() {
        let (alert, tenant) = fixtures();
        assert_eq!(
            fallback_text(&alert, &tenant),
            "[Acme Payments] [CRITICAL] Workers offline: 1 worker(s) went offline"
        );
    }

    #[test]
    fn tenant_name_is_escaped_for_mrkdwn() {
        let (alert, mut tenant) = fixtures();
        tenant.name = "Ops <A&B>".into();
        let blocks = build_blocks(&alert, &tenant);
        let context = blocks.last().unwrap();
        assert_eq!(context["elements"][0]["text"], "Tenant: *Ops &lt;A&amp;B&gt;*");
    }
}
