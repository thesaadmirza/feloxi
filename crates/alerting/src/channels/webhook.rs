use reqwest::Client;
use serde_json::{json, Value};
use std::collections::HashMap;

use super::SendResult;
use crate::engine::FiredAlert;
use crate::tenant::AlertTenant;

pub async fn send_webhook_alert(
    client: &Client,
    url: &str,
    headers: &Option<HashMap<String, String>>,
    alert: &FiredAlert,
    tenant: &AlertTenant,
) -> SendResult {
    let mut req = client.post(url).json(&build_payload(alert, tenant));

    if let Some(hdrs) = headers {
        for (key, value) in hdrs {
            req = req.header(key.as_str(), value.as_str());
        }
    }

    match req.send().await {
        Ok(resp) if resp.status().is_success() => SendResult::ok("webhook"),
        Ok(resp) => SendResult::err("webhook", format!("HTTP {}", resp.status())),
        // Strip the URL from the error — for a connected webhook the URL IS the
        // secret, and it would otherwise be persisted to alert history.
        Err(e) => SendResult::err("webhook", e.without_url()),
    }
}

/// The JSON body posted to a webhook endpoint. `tenant` says which tenant of
/// the instance fired the alert, so one endpoint can serve several tenants.
pub(crate) fn build_payload(alert: &FiredAlert, tenant: &AlertTenant) -> Value {
    let fired_at_iso = chrono::DateTime::from_timestamp(alert.fired_at as i64, 0)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|| alert.fired_at.to_string());

    json!({
        "alert_id": alert.id,
        "rule_id": alert.rule_id,
        "tenant": tenant,
        "rule_name": alert.rule_name,
        "condition_type": alert.condition_type,
        "severity": alert.severity,
        "summary": alert.summary,
        "details": alert.details,
        "fired_at": fired_at_iso,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    const RULE_ID: Uuid = Uuid::from_u128(0x2b1c);

    fn fixtures() -> (FiredAlert, AlertTenant) {
        let alert = FiredAlert {
            id: Uuid::nil(),
            rule_id: RULE_ID,
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
    fn payload_identifies_the_tenant() {
        let (alert, tenant) = fixtures();
        let payload = build_payload(&alert, &tenant);
        assert_eq!(payload["tenant"]["name"], "Acme Payments");
        assert_eq!(payload["tenant"]["slug"], "acme");
        assert_eq!(payload["tenant"]["id"], "00000000-0000-0000-0000-000000000000");
    }

    #[test]
    fn payload_carries_the_rule_id_to_join_on() {
        let (alert, tenant) = fixtures();
        let payload = build_payload(&alert, &tenant);
        assert_eq!(payload["rule_id"], RULE_ID.to_string());
    }

    #[test]
    fn payload_keeps_the_pre_existing_fields() {
        let (alert, tenant) = fixtures();
        let payload = build_payload(&alert, &tenant);
        assert_eq!(payload["rule_name"], "Workers offline");
        assert_eq!(payload["condition_type"], "worker_offline");
        assert_eq!(payload["severity"], "critical");
        assert_eq!(payload["summary"], "1 worker(s) went offline");
        assert_eq!(payload["details"]["workers_offline_count"], 1);
        assert_eq!(payload["fired_at"], "2023-11-14T22:13:20+00:00");
    }
}
