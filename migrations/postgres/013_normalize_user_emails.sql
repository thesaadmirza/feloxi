-- Normalize existing user emails to lowercase so (tenant_id, email) deduping
-- is case-insensitive in practice. New writes are also lowercased in Rust.
UPDATE users SET email = LOWER(email) WHERE email <> LOWER(email);
