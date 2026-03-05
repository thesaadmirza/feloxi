use crate::engine::FiredAlert;
use crate::templates;
use super::SendResult;

use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

/// Send email alert via SMTP.
pub async fn send_email_alert(
    to: &[String],
    alert: &FiredAlert,
    smtp_config: &SmtpConfig,
) -> SendResult {
    if to.is_empty() {
        return SendResult::err("email", "No recipients specified");
    }

    if smtp_config.host.is_empty() {
        tracing::warn!(
            rule = %alert.rule_name,
            "Email channel skipped — SMTP not configured"
        );
        return SendResult::err("email", "SMTP not configured");
    }

    let subject = templates::format_plain_text(alert);
    let html_body = templates::format_html(alert);

    // Build the email
    let mut email_builder = Message::builder()
        .from(
            smtp_config
                .from_address
                .parse()
                .unwrap_or_else(|_| "alerts@feloxi.dev".parse().unwrap()),
        )
        .subject(&subject);

    for recipient in to {
        match recipient.parse() {
            Ok(addr) => email_builder = email_builder.to(addr),
            Err(e) => {
                tracing::warn!(recipient, error = %e, "Skipping invalid email recipient");
            }
        }
    }

    let email = match email_builder
        .header(ContentType::TEXT_HTML)
        .body(html_body)
    {
        Ok(e) => e,
        Err(e) => return SendResult::err("email", format!("Failed to build email: {e}")),
    };

    // Build SMTP transport
    let transport_result = if smtp_config.tls {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&smtp_config.host)
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::relay(&smtp_config.host)
    };

    let transport = match transport_result {
        Ok(builder) => builder
            .port(smtp_config.port)
            .credentials(Credentials::new(
                smtp_config.username.clone(),
                smtp_config.password.clone(),
            ))
            .build(),
        Err(e) => return SendResult::err("email", format!("SMTP transport error: {e}")),
    };

    // Send
    match transport.send(email).await {
        Ok(_) => {
            tracing::info!(
                rule = %alert.rule_name,
                recipients = ?to,
                "Email alert sent successfully"
            );
            SendResult::ok("email")
        }
        Err(e) => {
            tracing::error!(
                rule = %alert.rule_name,
                error = %e,
                "Failed to send email alert"
            );
            SendResult::err("email", format!("SMTP send failed: {e}"))
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
