use std::hash::{Hash, Hasher};
use std::sync::{Arc, OnceLock};

use super::SendResult;
use crate::engine::FiredAlert;
use crate::templates;

use dashmap::DashMap;
use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

type SmtpTransport = Arc<AsyncSmtpTransport<Tokio1Executor>>;

/// Per-process cache of SMTP transports keyed by config hash. Alert evaluation
/// fires every 60s for every tenant with an email channel — without this cache
/// each fire rebuilds the TLS+auth handshake.
fn transport_cache() -> &'static DashMap<u64, SmtpTransport> {
    static CACHE: OnceLock<DashMap<u64, SmtpTransport>> = OnceLock::new();
    CACHE.get_or_init(DashMap::new)
}

fn smtp_config_key(cfg: &SmtpConfig) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    cfg.host.hash(&mut hasher);
    cfg.port.hash(&mut hasher);
    cfg.username.hash(&mut hasher);
    cfg.password.hash(&mut hasher);
    cfg.tls.hash(&mut hasher);
    hasher.finish()
}

fn get_or_build_transport(cfg: &SmtpConfig) -> Result<SmtpTransport, String> {
    let key = smtp_config_key(cfg);
    let cache = transport_cache();
    if let Some(existing) = cache.get(&key) {
        return Ok(existing.clone());
    }

    let builder = if cfg.tls {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&cfg.host)
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::relay(&cfg.host)
    }
    .map_err(|e| format!("SMTP transport error: {e}"))?;

    let transport = Arc::new(
        builder
            .port(cfg.port)
            .credentials(Credentials::new(cfg.username.clone(), cfg.password.clone()))
            .build(),
    );

    Ok(cache.entry(key).or_insert(transport).clone())
}

/// Send an HTML email via SMTP, reusing a cached transport for the given config.
pub async fn send_email(
    to: &[String],
    subject: &str,
    html_body: String,
    smtp_config: &SmtpConfig,
) -> Result<(), String> {
    if to.is_empty() {
        return Err("No recipients specified".into());
    }
    if smtp_config.host.is_empty() {
        return Err("SMTP not configured".into());
    }

    let mut builder = Message::builder()
        .from(
            smtp_config
                .from_address
                .parse()
                .unwrap_or_else(|_| "alerts@feloxi.dev".parse().unwrap()),
        )
        .subject(subject);

    for recipient in to {
        match recipient.parse() {
            Ok(addr) => builder = builder.to(addr),
            Err(e) => {
                tracing::warn!(recipient, error = %e, "Skipping invalid email recipient");
            }
        }
    }

    let email = builder
        .header(ContentType::TEXT_HTML)
        .body(html_body)
        .map_err(|e| format!("Failed to build email: {e}"))?;

    let transport = get_or_build_transport(smtp_config)?;
    transport.send(email).await.map(|_| ()).map_err(|e| format!("SMTP send failed: {e}"))
}

/// Send an alert notification via email. Thin wrapper around [`send_email`].
pub async fn send_email_alert(
    to: &[String],
    alert: &FiredAlert,
    smtp_config: &SmtpConfig,
) -> SendResult {
    let subject = templates::format_plain_text(alert);
    let html_body = templates::format_html(alert);

    match send_email(to, &subject, html_body, smtp_config).await {
        Ok(()) => {
            tracing::info!(
                rule = %alert.rule_name,
                recipients = ?to,
                "Email alert sent successfully"
            );
            SendResult::ok("email")
        }
        Err(e) => {
            tracing::error!(rule = %alert.rule_name, error = %e, "Failed to send email alert");
            SendResult::err("email", e)
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub from_address: String,
    #[serde(default = "default_tls")]
    pub tls: bool,
}

fn default_tls() -> bool {
    true
}

impl Default for SmtpConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 587,
            username: String::new(),
            password: String::new(),
            from_address: "alerts@feloxi.dev".into(),
            tls: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smtp_config_deserialize_without_tls_defaults_true() {
        let json = r#"{"host":"smtp.test.com","port":25,"username":"u","password":"p","from_address":"a@b.com"}"#;
        let config: SmtpConfig = serde_json::from_str(json).unwrap();
        assert!(config.tls);
    }
}
