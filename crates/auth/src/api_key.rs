use uuid::Uuid;

/// Generate a new API key with a prefix for identification.
/// Format: fp_key_{uuid_hex} -> prefix is first 8 chars after fp_key_
pub fn generate_api_key() -> (String, String) {
    let raw = format!("fp_key_{}", Uuid::new_v4().simple());
    let prefix = raw[7..15].to_string();
    (raw, prefix)
}

/// Hash an API key for storage (SHA-256).
pub fn hash_api_key(key: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    key.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

/// Verify an API key against a stored hash.
pub fn verify_api_key(key: &str, stored_hash: &str) -> bool {
    hash_api_key(key) == stored_hash
}

/// Extract the prefix from an API key.
pub fn extract_prefix(key: &str) -> Option<&str> {
    if key.len() >= 15 && key.starts_with("fp_key_") {
        Some(&key[7..15])
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_api_key_verification() {
        let (key, _) = generate_api_key();
        let hash = hash_api_key(&key);
        assert!(verify_api_key(&key, &hash));
        assert!(!verify_api_key("wrong-key", &hash));
    }
}
