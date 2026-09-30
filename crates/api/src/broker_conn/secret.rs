//! Broker connection URLs at rest.
//!
//! A broker URL usually carries the broker password, so `connection_enc` holds
//! `enc:v1:<base64(AES-GCM blob)>` sealed with `ENCRYPTION_KEY`. Rows written
//! before encryption existed hold the plain URL; `open` still reads those and
//! `seal_legacy_rows` rewrites them at startup.

use base64::Engine;
use common::crypto::Encryptor;
use common::AppError;
use db::postgres::models::BrokerConfig;

use crate::state::AppState;

const PREFIX: &str = "enc:v1:";

pub fn seal(enc: &Encryptor, url: &str) -> Result<String, AppError> {
    let blob = enc
        .encrypt_str(url)
        .map_err(|e| AppError::Internal(format!("Failed to encrypt broker URL: {e}")))?;
    Ok(format!("{PREFIX}{}", base64::engine::general_purpose::STANDARD.encode(blob)))
}

pub fn open(enc: &Encryptor, stored: &str) -> Result<String, AppError> {
    let Some(b64) = stored.strip_prefix(PREFIX) else {
        return Ok(stored.to_string());
    };
    let blob = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|_| AppError::Internal("Stored broker URL is malformed".into()))?;
    enc.decrypt_str(&blob).map_err(|_| {
        AppError::Internal(
            "Stored broker URL can't be decrypted; was ENCRYPTION_KEY changed?".into(),
        )
    })
}

pub fn is_sealed(stored: &str) -> bool {
    stored.starts_with(PREFIX)
}

/// The plain connection URL for a stored config.
pub fn connection_url(state: &AppState, config: &BrokerConfig) -> Result<String, AppError> {
    open(&state.encryptor, &config.connection_enc)
}

/// Encrypt URLs stored in plaintext and scrub credentials from saved errors.
pub async fn seal_legacy_rows(state: &AppState) -> Result<(), AppError> {
    let configs = db::postgres::broker_configs::list_all_broker_configs(&state.pg).await?;
    for config in configs {
        let redacted_error =
            config.last_error.as_deref().map(common::redact::redact_url_credentials);
        let sealed = !is_sealed(&config.connection_enc);
        if !sealed && redacted_error.as_deref() == config.last_error.as_deref() {
            continue;
        }
        let connection_enc = if sealed {
            // Older demo seeds wrote a literal `encrypted:` in front of the URL.
            let url =
                config.connection_enc.strip_prefix("encrypted:").unwrap_or(&config.connection_enc);
            seal(&state.encryptor, url)?
        } else {
            config.connection_enc.clone()
        };
        db::postgres::broker_configs::rewrite_broker_secrets(
            &state.pg,
            config.id,
            &connection_enc,
            redacted_error.as_deref(),
        )
        .await?;
        tracing::info!(broker_id = %config.id, "Sealed stored broker credentials");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encryptor() -> Encryptor {
        Encryptor::from_base64(&base64::engine::general_purpose::STANDARD.encode([7u8; 32]))
            .unwrap()
    }

    #[test]
    fn round_trip() {
        let enc = encryptor();
        let url = "amqp://guest:s3cret@rabbit:5672//";
        let stored = seal(&enc, url).unwrap();
        assert!(is_sealed(&stored));
        assert!(!stored.contains("s3cret"));
        assert_eq!(open(&enc, &stored).unwrap(), url);
    }

    #[test]
    fn legacy_plaintext_reads_as_is() {
        assert_eq!(
            open(&encryptor(), "redis://localhost:6379/0").unwrap(),
            "redis://localhost:6379/0"
        );
    }

    #[test]
    fn wrong_key_is_an_error() {
        let stored = seal(&encryptor(), "redis://:pw@h:6379").unwrap();
        let other =
            Encryptor::from_base64(&base64::engine::general_purpose::STANDARD.encode([9u8; 32]))
                .unwrap();
        assert!(open(&other, &stored).is_err());
    }
}
