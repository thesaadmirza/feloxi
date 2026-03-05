use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use common::AppError;

#[derive(Debug, sqlx::FromRow)]
pub struct RefreshToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub tenant_id: Uuid,
    pub token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
}

/// Store a new refresh token (hashed).
pub async fn create_refresh_token(
    pool: &PgPool,
    user_id: Uuid,
    tenant_id: Uuid,
    token_hash: &str,
    expires_at: DateTime<Utc>,
) -> Result<RefreshToken, AppError> {
    let row = sqlx::query_as::<_, RefreshToken>(
        r#"
        INSERT INTO refresh_tokens (user_id, tenant_id, token_hash, expires_at)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        "#,
    )
    .bind(user_id)
    .bind(tenant_id)
    .bind(token_hash)
    .bind(expires_at)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

/// Look up a valid (non-revoked, non-expired) refresh token by its hash.
pub async fn find_valid_refresh_token(
    pool: &PgPool,
    token_hash: &str,
) -> Result<RefreshToken, AppError> {
    let row = sqlx::query_as::<_, RefreshToken>(
        r#"
        SELECT * FROM refresh_tokens
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > NOW()
        "#,
    )
    .bind(token_hash)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

/// Revoke a refresh token (used during rotation).
pub async fn revoke_refresh_token(pool: &PgPool, id: Uuid) -> Result<(), AppError> {
    sqlx::query("UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Revoke all refresh tokens for a user (e.g. on logout or password change).
pub async fn revoke_all_for_user(pool: &PgPool, user_id: Uuid) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}
