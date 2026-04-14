use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use common::AppError;

#[derive(Debug, sqlx::FromRow)]
pub struct MagicLinkToken {
    pub id: Uuid,
    pub email: String,
    pub token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub consumed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

pub async fn create_magic_link(
    pool: &PgPool,
    email: &str,
    token_hash: &str,
    expires_at: DateTime<Utc>,
) -> Result<MagicLinkToken, AppError> {
    let row = sqlx::query_as::<_, MagicLinkToken>(
        r#"
        INSERT INTO magic_link_tokens (email, token_hash, expires_at)
        VALUES ($1, $2, $3)
        RETURNING *
        "#,
    )
    .bind(email)
    .bind(token_hash)
    .bind(expires_at)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

/// Atomically consume a valid token: finds by hash, checks expiry + unconsumed,
/// and marks consumed in one statement so concurrent verify attempts can't
/// reuse the same link.
pub async fn consume_magic_link(
    pool: &PgPool,
    token_hash: &str,
) -> Result<Option<MagicLinkToken>, AppError> {
    let row = sqlx::query_as::<_, MagicLinkToken>(
        r#"
        UPDATE magic_link_tokens
           SET consumed_at = NOW()
         WHERE token_hash = $1
           AND consumed_at IS NULL
           AND expires_at > NOW()
        RETURNING *
        "#,
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}
