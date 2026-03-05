use crate::engine::FiredAlert;

/// Format an alert as a plain text message.
pub fn format_plain_text(alert: &FiredAlert) -> String {
    format!(
        "[{severity}] {rule}: {summary}",
        severity = alert.severity.to_uppercase(),
        rule = alert.rule_name,
        summary = alert.summary,
    )
}

/// Format an alert as an HTML message (for email).
pub fn format_html(alert: &FiredAlert) -> String {
    let color = match alert.severity.as_str() {
        "critical" => "#dc2626",
        "warning" => "#f59e0b",
        _ => "#10b981",
    };

    format!(
        r#"
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: {color}; color: white; padding: 16px; border-radius: 8px 8px 0 0;">
                <h2 style="margin: 0;">🚨 {severity} Alert</h2>
                <p style="margin: 4px 0 0 0; opacity: 0.9;">{rule}</p>
            </div>
            <div style="background: #f9fafb; padding: 16px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                <p style="font-size: 16px; color: #111827;">{summary}</p>
                <hr style="border: none; border-top: 1px solid #e5e7eb;">
                <p style="font-size: 12px; color: #6b7280;">
                    Sent by Feloxi Alert Engine
                </p>
            </div>
        </div>
        "#,
        color = color,
        severity = alert.severity.to_uppercase(),
        rule = alert.rule_name,
        summary = alert.summary,
    )
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
            severity: severity.into(),
            summary: summary.into(),
            details: serde_json::json!({}),
            fired_at: 1700000000.0,
        }
    }

    #[test]
    fn plain_text_format() {
        let cases = [
            (
                "critical",
                "Worker Alert",
                "2 workers offline",
                "[CRITICAL] Worker Alert: 2 workers offline",
            ),
            (
                "warning",
                "Queue Alert",
                "Queue depth high",
                "[WARNING] Queue Alert: Queue depth high",
            ),
            ("info", "Info", "All normal", "[INFO] Info: All normal"),
        ];
        for (sev, name, summary, expected) in &cases {
            assert_eq!(format_plain_text(&make_alert(sev, name, summary)), *expected);
        }
    }

    #[test]
    fn html_severity_colors_and_structure() {
        let cases = [
            ("critical", "#dc2626"),
            ("warning", "#f59e0b"),
            ("info", "#10b981"),
            ("unknown", "#10b981"),
        ];
        for (sev, color) in &cases {
            let html = format_html(&make_alert(sev, "Rule", "msg"));
            assert!(html.contains(color), "{sev} should use {color}");
            assert!(html.contains(&sev.to_uppercase()));
            assert!(html.contains("Feloxi Alert Engine"));
            assert!(html.contains("<div"));
            assert!(html.contains("font-family"));
        }
    }
}
