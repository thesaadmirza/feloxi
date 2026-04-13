use sqlx::PgPool;

use super::models::{CreateUserInvite, UserInvite};
use common::AppError;

pub async fn create_invite(
    pool: &PgPool,
    input: &CreateUserInvite,
) -> Result<UserInvite, AppError> {
    // Delete + insert is wrapped in a transaction so concurrent invites for the same
    // (tenant, email) can't both win the partial unique index race.
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        DELETE FROM user_invites
        WHERE tenant_id = $1 AND email = $2 AND accepted_at IS NULL
        "#,
    )
    .bind(input.tenant_id)
    .bind(&input.email)
    .execute(&mut *tx)
    .await?;

    let invite = sqlx::query_as::<_, UserInvite>(
        r#"
        INSERT INTO user_invites
            (tenant_id, email, role_name, token_hash, invited_by, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        "#,
    )
    .bind(input.tenant_id)
    .bind(&input.email)
    .bind(&input.role_name)
    .bind(&input.token_hash)
    .bind(input.invited_by)
    .bind(input.expires_at)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(invite)
}

/// Preview a pending invite without consuming it.
pub async fn find_pending_invite(pool: &PgPool, token_hash: &str) -> Result<UserInvite, AppError> {
    sqlx::query_as::<_, UserInvite>(
        r#"
        SELECT * FROM user_invites
        WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > NOW()
        "#,
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Invite not found or expired".into()))
}

/// Atomically consume an invite: marks it accepted and returns the row in a
/// single UPDATE. Prevents two concurrent accept_invite calls from both
/// succeeding on the same token.
pub async fn claim_invite(pool: &PgPool, token_hash: &str) -> Result<UserInvite, AppError> {
    sqlx::query_as::<_, UserInvite>(
        r#"
        UPDATE user_invites
        SET accepted_at = NOW()
        WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > NOW()
        RETURNING *
        "#,
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Invite not found or expired".into()))
}
