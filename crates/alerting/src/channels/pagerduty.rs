use reqwest::Client;
use serde_json::{json, Value};

use super::SendResult;
use crate::engine::FiredAlert;
use crate::tenant::AlertTenant;

const PAGERDUTY_EVENTS_URL: &str = "https://events.pagerduty.com/v2/enqueue";

pub async fn send_pagerduty_alert(
    client: &Client,
    routing_key: &str,
    alert: &FiredAlert,
    tenant: &AlertTenant,
) -> SendResult {
    let payload = build_payload(routing_key, alert, tenant);

    match client.post(PAGERDUTY_EVENTS_URL).json(&payload).send().await {
        Ok(resp) if resp.status().is_success() => SendResult::ok("pagerduty"),
        Ok(resp) => SendResult::err("pagerduty", format!("HTTP {}", resp.status())),
        Err(e) => SendResult::err("pagerduty", e),
    }
}

/// Build the Events API v2 trigger. The tenant becomes the incident `source`
/// (what PagerDuty shows in the incident list) and is repeated in
/// `custom_details` for machine consumers. `dedup_key` is unchanged — it
/// already carries the tenant, and altering it would orphan open incidents.
fn build_payload(routing_key: &str, alert: &FiredAlert, tenant: &AlertTenant) -> Value {
    let severity = match alert.severity.as_str() {
        "critical" => "critical",
        "warning" => "warning",
        _ => "info",
    };

    let condition_type = alert.condition_type.as_deref().unwrap_or("alert");

    // `source` is required and must be non-empty.
    let source = if tenant.name.trim().is_empty() { "Feloxi" } else { tenant.name.as_str() };

    let mut custom_details = alert.details.clone();
    if let Some(obj) = custom_details.as_object_mut() {
        obj.insert("tenant".into(), json!(tenant.name));
        obj.insert("tenant_slug".into(), json!(tenant.slug));
    }

    json!({
        "routing_key": routing_key,
        "event_action": "trigger",
        "payload": {
            "summary": alert.summary,
            "severity": severity,
            "source": source,
            "component": alert.rule_name,
            "group": condition_type,
            "class": condition_type,
            "custom_details": custom_details,
        },
        "dedup_key": format!("fp-{}-{}", alert.rule_id, alert.tenant_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::channels::fixtures::{self, RULE_ID};

    #[test]
    fn tenant_becomes_the_source_and_reaches_custom_details() {
        let payload = build_payload("routing-key", &fixtures::alert(), &fixtures::tenant());
        assert_eq!(payload["payload"]["source"], "Acme Payments");
        assert_eq!(payload["payload"]["custom_details"]["tenant"], "Acme Payments");
        assert_eq!(payload["payload"]["custom_details"]["tenant_slug"], "acme");
        // Condition details survive alongside the tenant keys.
        assert_eq!(payload["payload"]["custom_details"]["workers_offline_count"], 1);
        // Dedup stays keyed on rule+tenant so open incidents keep matching.
        assert_eq!(payload["dedup_key"], format!("fp-{}-{}", RULE_ID, uuid::Uuid::nil()));
    }

    #[test]
    fn blank_tenant_name_falls_back_to_a_valid_source() {
        let tenant = AlertTenant { name: "  ".into(), ..fixtures::tenant() };
        let payload = build_payload("routing-key", &fixtures::alert(), &tenant);
        assert_eq!(payload["payload"]["source"], "Feloxi");
    }
}
