//! Secrets at rest (AES-256-GCM) and domain-separated HMAC signing for OAuth state.
//!
//! Stored secrets (integration tokens, SMTP password) are encrypted with a
//! dedicated `ENCRYPTION_KEY`, kept strictly separate from `JWT_SECRET`. The
//! ciphertext layout is `version(1) || nonce(12) || ciphertext`; the leading
//! version byte is the discriminator for future key rotation — a GCM decrypt
//! failure is always a hard error (tamper / wrong key), never a silent
//! fallback to treating the bytes as plaintext.

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// AES-GCM ciphertext version marker (leading byte).
const VERSION_V1: u8 = 0x01;
/// AES-GCM nonce length in bytes (96-bit, the standard for GCM).
const NONCE_LEN: usize = 12;

#[derive(thiserror::Error, Debug)]
pub enum CryptoError {
    #[error("invalid encryption key: {0}")]
    InvalidKey(String),
    #[error("encryption failed")]
    Encrypt,
    #[error("decryption failed")]
    Decrypt,
    #[error("malformed ciphertext")]
    Malformed,
}

/// Encrypts/decrypts secrets with AES-256-GCM and signs short OAuth state blobs.
///
/// `Clone` is cheap (the inner cipher holds the expanded key). `Debug` is
/// redacted so the key never appears in logs.
#[derive(Clone)]
pub struct Encryptor {
    cipher: Aes256Gcm,
    /// Raw key bytes, reused for HMAC signing under distinct domain labels.
    hmac_key: [u8; 32],
}

impl std::fmt::Debug for Encryptor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Encryptor(<redacted>)")
    }
}

impl Encryptor {
    /// Build from a base64-encoded 32-byte key (the `ENCRYPTION_KEY` env var).
    pub fn from_base64(b64: &str) -> Result<Self, CryptoError> {
        let raw = base64::engine::general_purpose::STANDARD
            .decode(b64.trim())
            .map_err(|e| CryptoError::InvalidKey(e.to_string()))?;
        let key: [u8; 32] = raw.as_slice().try_into().map_err(|_| {
            CryptoError::InvalidKey(format!("expected 32 bytes, got {}", raw.len()))
        })?;
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
        Ok(Self { cipher, hmac_key: key })
    }

    /// Encrypt plaintext into `version(1) || nonce(12) || ciphertext`.
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ct = self.cipher.encrypt(&nonce, plaintext).map_err(|_| CryptoError::Encrypt)?;
        let mut out = Vec::with_capacity(1 + NONCE_LEN + ct.len());
        out.push(VERSION_V1);
        out.extend_from_slice(nonce.as_slice());
        out.extend_from_slice(&ct);
        Ok(out)
    }

    /// Decrypt a versioned blob produced by [`encrypt`](Self::encrypt).
    pub fn decrypt(&self, blob: &[u8]) -> Result<Vec<u8>, CryptoError> {
        match blob.first() {
            Some(&VERSION_V1) if blob.len() > NONCE_LEN => {
                let nonce = Nonce::from_slice(&blob[1..1 + NONCE_LEN]);
                self.cipher.decrypt(nonce, &blob[1 + NONCE_LEN..]).map_err(|_| CryptoError::Decrypt)
            }
            _ => Err(CryptoError::Malformed),
        }
    }

    /// Convenience: encrypt a UTF-8 string.
    pub fn encrypt_str(&self, s: &str) -> Result<Vec<u8>, CryptoError> {
        self.encrypt(s.as_bytes())
    }

    /// Convenience: decrypt to a UTF-8 string.
    pub fn decrypt_str(&self, blob: &[u8]) -> Result<String, CryptoError> {
        String::from_utf8(self.decrypt(blob)?).map_err(|_| CryptoError::Malformed)
    }

    /// Sign a payload under a domain label, returning `base64(hmac)`.
    ///
    /// The `domain` label keeps OAuth-state signatures cryptographically
    /// distinct from other HMAC uses of the same key (e.g.
    /// `"feloxi-oauth-state-v1"`, `"feloxi-google-orgpick-v1"`).
    pub fn sign(&self, domain: &str, payload: &[u8]) -> String {
        let mut mac = <HmacSha256 as Mac>::new_from_slice(&self.hmac_key)
            .expect("HMAC accepts keys of any length");
        mac.update(domain.as_bytes());
        mac.update(b"\x00");
        mac.update(payload);
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    }

    /// Verify a `base64(hmac)` signature in constant time.
    pub fn verify(&self, domain: &str, payload: &[u8], signature_b64: &str) -> bool {
        let Ok(sig) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(signature_b64) else {
            return false;
        };
        let mut mac = <HmacSha256 as Mac>::new_from_slice(&self.hmac_key)
            .expect("HMAC accepts keys of any length");
        mac.update(domain.as_bytes());
        mac.update(b"\x00");
        mac.update(payload);
        mac.verify_slice(&sig).is_ok()
    }
}

/// A string secret whose `Debug`/`Display` never reveal the value.
///
/// Wrap decrypted tokens / passwords in this so a stray `?secret` /
/// `#[derive(Debug)]` doesn't leak them into logs or error bodies.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// Borrow the underlying secret. Naming the call site makes leaks auditable.
    pub fn expose(&self) -> &str {
        &self.0
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(<redacted>)")
    }
}

impl From<String> for Secret {
    fn from(s: String) -> Self {
        Self(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_encryptor() -> Encryptor {
        // 32 bytes of 0x2a, base64-encoded.
        let key = base64::engine::general_purpose::STANDARD.encode([0x2a_u8; 32]);
        Encryptor::from_base64(&key).unwrap()
    }

    #[test]
    fn round_trip() {
        let enc = test_encryptor();
        let blob = enc.encrypt_str("xoxb-super-secret").unwrap();
        assert_eq!(enc.decrypt_str(&blob).unwrap(), "xoxb-super-secret");
    }

    #[test]
    fn version_byte_is_present() {
        let enc = test_encryptor();
        let blob = enc.encrypt(b"hello").unwrap();
        assert_eq!(blob[0], VERSION_V1);
        assert!(blob.len() > 1 + NONCE_LEN);
    }

    #[test]
    fn distinct_ciphertext_per_encrypt() {
        // Random nonce => same plaintext encrypts to different bytes.
        let enc = test_encryptor();
        let a = enc.encrypt(b"same").unwrap();
        let b = enc.encrypt(b"same").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn flipped_byte_is_rejected() {
        let enc = test_encryptor();
        let mut blob = enc.encrypt(b"tamper-me").unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 0xff;
        assert!(matches!(enc.decrypt(&blob), Err(CryptoError::Decrypt)));
    }

    #[test]
    fn unknown_version_is_malformed() {
        let enc = test_encryptor();
        // A legacy plaintext value must NOT decrypt — it has no version marker.
        assert!(matches!(enc.decrypt(b"plaintext-password"), Err(CryptoError::Malformed)));
        assert!(matches!(enc.decrypt(&[]), Err(CryptoError::Malformed)));
    }

    #[test]
    fn wrong_key_cannot_decrypt() {
        let enc = test_encryptor();
        let blob = enc.encrypt(b"secret").unwrap();
        let other = Encryptor::from_base64(
            &base64::engine::general_purpose::STANDARD.encode([0x99_u8; 32]),
        )
        .unwrap();
        assert!(matches!(other.decrypt(&blob), Err(CryptoError::Decrypt)));
    }

    #[test]
    fn rejects_wrong_key_length() {
        let short = base64::engine::general_purpose::STANDARD.encode([0u8; 16]);
        assert!(matches!(Encryptor::from_base64(&short), Err(CryptoError::InvalidKey(_))));
    }

    #[test]
    fn sign_verify_round_trip_and_domain_separation() {
        let enc = test_encryptor();
        let sig = enc.sign("feloxi-oauth-state-v1", b"tenant=abc");
        assert!(enc.verify("feloxi-oauth-state-v1", b"tenant=abc", &sig));
        // Wrong domain or payload fails.
        assert!(!enc.verify("feloxi-google-orgpick-v1", b"tenant=abc", &sig));
        assert!(!enc.verify("feloxi-oauth-state-v1", b"tenant=xyz", &sig));
        assert!(!enc.verify("feloxi-oauth-state-v1", b"tenant=abc", "not-base64!!"));
    }

    #[test]
    fn secret_debug_is_redacted() {
        let s = Secret::new("hunter2");
        assert_eq!(format!("{s:?}"), "Secret(<redacted>)");
        assert_eq!(s.expose(), "hunter2");
    }
}
