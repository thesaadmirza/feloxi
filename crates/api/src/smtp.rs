use db::postgres::models::Tenant;

use crate::routes::responses::NotificationSettings;

/// Extract a tenant's SMTP configuration from its `settings.notifications` blob.
/// Returns a default (empty-host) config if the setting is missing — callers
/// should treat an empty `host` as "not configured".
pub(crate) fn tenant_smtp_config(tenant: &Tenant) -> alerting::channels::email::SmtpConfig {
    let notif: NotificationSettings = tenant
        .settings
        .get("notifications")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    alerting::channels::email::SmtpConfig {
        host: notif.smtp.host,
        port: notif.smtp.port,
        username: notif.smtp.username,
        password: notif.smtp.password,
        from_address: notif.smtp.from_address,
        tls: notif.smtp.tls,
    }
}
