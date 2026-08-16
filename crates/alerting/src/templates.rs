use common::html::escape;

use crate::engine::FiredAlert;
use crate::tenant::AlertTenant;

/// Format an alert as a plain text message. Used as the email subject, so it
/// leads with the tenant — one inbox can collect alerts from several tenants.
pub fn format_plain_text(alert: &FiredAlert, tenant: &AlertTenant) -> String {
    let ct = alert.condition_type.as_deref().map(|t| format!(" ({t})")).unwrap_or_default();
    format!(
        "[{tenant}] [{severity}] {rule}{ct}: {summary}",
        tenant = tenant.name,
        severity = alert.severity.to_uppercase(),
        rule = alert.rule_name,
        summary = alert.summary,
    )
}

/// Format an alert as an HTML message (for email). Every interpolated value is
/// user-controlled (tenant name, rule name, summary, condition details), so it
/// is HTML-escaped on the way in.
pub fn format_html(alert: &FiredAlert, tenant: &AlertTenant) -> String {
    let color = match alert.severity.as_str() {
        "critical" => "#dc2626",
        "warning" => "#f59e0b",
        _ => "#10b981",
    };

    let condition_badge = alert
        .condition_type
        .as_deref()
        .map(|ct| {
            let ct = escape(ct);
            format!(
                r#"<span style="display:inline-block;background:#374151;color:#d1d5db;
                    font-size:11px;padding:2px 8px;border-radius:4px;margin-bottom:8px;">
                    {ct}</span><br>"#
            )
        })
        .unwrap_or_default();

    let details_table = build_details_table(&alert.details);

    format!(
        r#"<div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
    <div style="background:{color};color:white;padding:16px;border-radius:8px 8px 0 0;">
        <p style="margin:0 0 4px;opacity:0.85;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;">{tenant}</p>
        <h2 style="margin:0;">{severity} Alert</h2>
        <p style="margin:4px 0 0;opacity:0.9;">{rule}</p>
    </div>
    <div style="background:#f9fafb;padding:16px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        {condition_badge}
        <p style="font-size:16px;color:#111827;margin:0 0 12px;">{summary}</p>
        {details_table}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;">
        <p style="font-size:12px;color:#6b7280;margin:0;">
            Sent by Feloxi Alert Engine
        </p>
    </div>
</div>"#,
        color = color,
        tenant = escape(&tenant.name),
        severity = escape(&alert.severity.to_uppercase()),
        rule = escape(&alert.rule_name),
        summary = escape(&alert.summary),
    )
}

fn build_details_table(details: &serde_json::Value) -> String {
    let obj = match details.as_object() {
        Some(o) if !o.is_empty() => o,
        _ => return String::new(),
    };

    let rows: Vec<String> = obj
        .iter()
        .map(|(key, value)| {
            let label = escape(&snake_to_title(key));
            let display = escape(&format_value(key, value));
            format!(
                r#"<tr>
    <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">{label}</td>
    <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:13px;font-weight:500;">{display}</td>
</tr>"#
            )
        })
        .collect();

    format!(
        r#"<table style="width:100%;border-collapse:collapse;margin:8px 0 12px;">
    <thead><tr>
        <th style="text-align:left;padding:6px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-size:11px;text-transform:uppercase;">Metric</th>
        <th style="text-align:left;padding:6px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-size:11px;text-transform:uppercase;">Value</th>
    </tr></thead>
    <tbody>{}</tbody>
</table>"#,
        rows.join("\n")
    )
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

fn format_value(key: &str, value: &serde_json::Value) -> String {
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

    fn make_alert(severity: &str, rule_name: &str, summary: &str) -> FiredAlert {
        FiredAlert {
            id: Uuid::nil(),
            rule_id: Uuid::nil(),
            tenant_id: Uuid::nil(),
            rule_name: rule_name.into(),
            condition_type: Some("task_failure_rate".into()),
            severity: severity.into(),
            summary: summary.into(),
            details: serde_json::json!({
                "task_name": "*",
                "failure_rate": 0.333,
                "threshold": 0.1,
                "recent_failures": 4
            }),
            fired_at: 1700000000.0,
        }
    }

    fn make_tenant() -> AlertTenant {
        AlertTenant { id: Uuid::nil(), name: "Acme Payments".into(), slug: "acme".into() }
    }

    #[test]
    fn plain_text_includes_tenant_and_condition_type() {
        let alert = make_alert("critical", "Worker Alert", "2 workers offline");
        let text = format_plain_text(&alert, &make_tenant());
        assert!(text.starts_with("[Acme Payments] [CRITICAL]"));
        assert!(text.contains("(task_failure_rate)"));

        // Without condition_type
        let mut alert_no_ct = alert;
        alert_no_ct.condition_type = None;
        let text = format_plain_text(&alert_no_ct, &make_tenant());
        assert!(!text.contains("(task_failure_rate)"));
    }

    #[test]
    fn html_contains_metrics_table() {
        let alert = make_alert("warning", "Rate Alert", "33% failure rate");
        let html = format_html(&alert, &make_tenant());
        assert!(html.contains("<table"), "should contain metrics table");
        assert!(html.contains("Failure Rate"), "should have title-cased key");
        assert!(html.contains("33.3%"), "should format rate as percentage");
        assert!(html.contains("task_failure_rate"), "should show condition badge");
        assert!(html.contains("Feloxi Alert Engine"));
    }

    #[test]
    fn html_header_names_the_tenant() {
        let alert = make_alert("critical", "Rate Alert", "33% failure rate");
        let html = format_html(&alert, &make_tenant());
        assert!(html.contains("Acme Payments"));
    }

    #[test]
    fn html_escapes_user_controlled_text() {
        let alert = make_alert("warning", "<img src=x onerror=alert(1)>", "a & b");
        let tenant = AlertTenant {
            id: Uuid::nil(),
            name: "<script>steal()</script>".into(),
            slug: "acme".into(),
        };
        let html = format_html(&alert, &tenant);
        assert!(!html.contains("<img"), "rule name must not inject markup");
        assert!(!html.contains("<script>"), "tenant name must not inject markup");
        assert!(html.contains("&lt;img src=x onerror=alert(1)&gt;"));
        assert!(html.contains("a &amp; b"));
    }

    #[test]
    fn html_no_table_when_empty_details() {
        let mut alert = make_alert("info", "Test", "ok");
        alert.details = serde_json::json!({});
        let html = format_html(&alert, &make_tenant());
        assert!(!html.contains("<table"));
    }

    #[test]
    fn format_value_heuristics() {
        assert_eq!(format_value("failure_rate", &serde_json::json!(0.333)), "33.3%");
        assert_eq!(format_value("threshold_seconds", &serde_json::json!(10.5)), "10.50s");
        assert_eq!(format_value("p95_runtime", &serde_json::json!(0.049)), "0.05s");
        assert_eq!(format_value("spike_factor", &serde_json::json!(2.5)), "2.5");
        assert_eq!(format_value("recent_failures", &serde_json::json!(4)), "4");
        assert_eq!(format_value("task_name", &serde_json::json!("tasks.add")), "tasks.add");
    }

    #[test]
    fn snake_to_title_cases() {
        assert_eq!(snake_to_title("failure_rate"), "Failure Rate");
        assert_eq!(snake_to_title("p95_runtime"), "P95 Runtime");
        assert_eq!(snake_to_title("task_name"), "Task Name");
    }
}
