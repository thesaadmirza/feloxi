use argon2::{
    password_hash::{rand_core::OsRng, SaltString},
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
};
use common::AppError;

pub const MIN_PASSWORD_CHARS: usize = 8;

pub fn validate_password(password: &str) -> Result<(), AppError> {
    if password.chars().count() < MIN_PASSWORD_CHARS {
        return Err(AppError::Validation(format!(
            "Password must be at least {MIN_PASSWORD_CHARS} characters"
        )));
    }
    Ok(())
}

/// Hash a password using Argon2id.
pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2.hash_password(password.as_bytes(), &salt)?;
    Ok(hash.to_string())
}

/// Verify a password against a hash.
pub fn verify_password(password: &str, hash: &str) -> Result<bool, argon2::password_hash::Error> {
    let parsed_hash = PasswordHash::new(hash)?;
    Ok(Argon2::default().verify_password(password.as_bytes(), &parsed_hash).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_and_verify() {
        let password = "correct-horse-battery-staple";
        let hash = hash_password(password).unwrap();
        assert!(verify_password(password, &hash).unwrap());
        assert!(!verify_password("wrong-password", &hash).unwrap());
    }

    #[test]
    fn test_hash_produces_different_hashes_for_same_input() {
        // Each call generates a random salt, so hashes should differ
        let password = "same-password-different-salt";
        let hash1 = hash_password(password).unwrap();
        let hash2 = hash_password(password).unwrap();
        assert_ne!(hash1, hash2, "Different salts should produce different hashes");
        // But both should still verify
        assert!(verify_password(password, &hash1).unwrap());
        assert!(verify_password(password, &hash2).unwrap());
    }

    #[test]
    fn test_verify_wrong_password_returns_false() {
        let hash = hash_password("original").unwrap();
        assert!(!verify_password("different", &hash).unwrap());
        assert!(!verify_password("", &hash).unwrap());
        assert!(!verify_password("Original", &hash).unwrap()); // case sensitive
    }

    #[test]
    fn test_verify_invalid_hash_returns_error() {
        let result = verify_password("password", "not-a-valid-hash");
        assert!(result.is_err(), "Invalid hash format should return an error");
    }

    #[test]
    fn test_hash_unicode_password() {
        let password = "p\u{00e4}ssw\u{00f6}rd-\u{1f600}-\u{4e16}\u{754c}";
        let hash = hash_password(password).unwrap();
        assert!(verify_password(password, &hash).unwrap());
        assert!(!verify_password("password", &hash).unwrap());
    }
}
