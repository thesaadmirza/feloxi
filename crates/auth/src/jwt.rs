use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// JWT claims for access tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// Subject: user ID.
    pub sub: Uuid,
    /// Tenant ID.
    pub tid: Uuid,
    /// User email.
    pub email: String,
    /// Role names.
    pub roles: Vec<String>,
    /// Permissions list.
    pub permissions: Vec<String>,
    /// Issued at.
    pub iat: i64,
    /// Expiration.
    pub exp: i64,
}

/// Keys for JWT signing/verification.
#[derive(Clone)]
pub struct JwtKeys {
    encoding: EncodingKey,
    decoding: DecodingKey,
}

impl JwtKeys {
    pub fn new(secret: &[u8]) -> Self {
        Self {
            encoding: EncodingKey::from_secret(secret),
            decoding: DecodingKey::from_secret(secret),
        }
    }
}

/// Issue a new access token (15 minute TTL).
pub fn issue_access_token(
    keys: &JwtKeys,
    user_id: Uuid,
    tenant_id: Uuid,
    email: &str,
    roles: Vec<String>,
    permissions: Vec<String>,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id,
        tid: tenant_id,
        email: email.to_string(),
        roles,
        permissions,
        iat: now.timestamp(),
        exp: (now + Duration::minutes(15)).timestamp(),
    };

    encode(&Header::default(), &claims, &keys.encoding)
}

/// Verify and decode an access token.
pub fn verify_access_token(
    keys: &JwtKeys,
    token: &str,
) -> Result<Claims, jsonwebtoken::errors::Error> {
    let validation = Validation::default();
    let data = decode::<Claims>(token, &keys.decoding, &validation)?;
    Ok(data.claims)
}

/// Generate a random refresh token.
pub fn generate_refresh_token() -> String {
    format!("fp_rt_{}", Uuid::new_v4().simple())
}

/// Hash a refresh token for storage using SHA-256.
pub fn hash_refresh_token(token: &str) -> String {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_keys() -> JwtKeys {
        JwtKeys::new(b"test-secret-key-for-testing-only")
    }

    fn issue_test_token(keys: &JwtKeys) -> (String, Uuid, Uuid) {
        let user_id = Uuid::new_v4();
        let tenant_id = Uuid::new_v4();
        let token = issue_access_token(
            keys,
            user_id,
            tenant_id,
            "test@example.com",
            vec!["admin".to_string()],
            vec!["tasks_read".to_string(), "workers_read".to_string()],
        )
        .unwrap();
        (token, user_id, tenant_id)
    }

    #[test]
    fn test_jwt_roundtrip() {
        let keys = test_keys();
        let user_id = Uuid::new_v4();
        let tenant_id = Uuid::new_v4();

        let token = issue_access_token(
            &keys,
            user_id,
            tenant_id,
            "test@example.com",
            vec!["admin".to_string()],
            vec!["tasks_read".to_string()],
        )
        .unwrap();

        let claims = verify_access_token(&keys, &token).unwrap();
        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.tid, tenant_id);
        assert_eq!(claims.email, "test@example.com");
    }

    #[test]
    fn test_jwt_expiry_is_15_minutes_from_now() {
        let keys = test_keys();
        let (token, _, _) = issue_test_token(&keys);
        let claims = verify_access_token(&keys, &token).unwrap();

        let expected_ttl = 15 * 60; // 15 minutes in seconds
        let actual_ttl = claims.exp - claims.iat;
        assert_eq!(actual_ttl, expected_ttl, "Token TTL should be 15 minutes");
    }

    #[test]
    fn test_jwt_invalid_signature_rejected() {
        let keys1 = JwtKeys::new(b"secret-key-one");
        let keys2 = JwtKeys::new(b"secret-key-two");

        let (token, _, _) = issue_test_token(&keys1);
        let result = verify_access_token(&keys2, &token);
        assert!(result.is_err(), "Token signed with different key must be rejected");
    }

    #[test]
    fn test_jwt_garbage_token_rejected() {
        let keys = test_keys();
        let result = verify_access_token(&keys, "not.a.valid.jwt.token");
        assert!(result.is_err());
    }

    #[test]
    fn test_jwt_empty_token_rejected() {
        let keys = test_keys();
        let result = verify_access_token(&keys, "");
        assert!(result.is_err());
    }

    #[test]
    fn test_jwt_tampered_payload_rejected() {
        let keys = test_keys();
        let (token, _, _) = issue_test_token(&keys);

        // Tamper with payload by changing a character
        let parts: Vec<&str> = token.split('.').collect();
        assert_eq!(parts.len(), 3);
        let mut tampered_payload = parts[1].to_string();
        // Flip a character to simulate tampering
        if tampered_payload.ends_with('A') {
            tampered_payload.push('B');
        } else {
            tampered_payload.push('A');
        }
        let tampered_token = format!("{}.{}.{}", parts[0], tampered_payload, parts[2]);

        let result = verify_access_token(&keys, &tampered_token);
        assert!(result.is_err(), "Tampered token should be rejected");
    }

    #[test]
    fn test_jwt_expired_token_rejected() {
        let keys = test_keys();
        let user_id = Uuid::new_v4();
        let tenant_id = Uuid::new_v4();

        // Manually create an expired token
        let now = Utc::now();
        let claims = Claims {
            sub: user_id,
            tid: tenant_id,
            email: "test@example.com".to_string(),
            roles: vec![],
            permissions: vec![],
            iat: (now - Duration::hours(2)).timestamp(),
            exp: (now - Duration::hours(1)).timestamp(), // expired 1 hour ago
        };

        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(b"test-secret-key-for-testing-only"),
        )
        .unwrap();

        let result = verify_access_token(&keys, &token);
        assert!(result.is_err(), "Expired token must be rejected");
    }

}
