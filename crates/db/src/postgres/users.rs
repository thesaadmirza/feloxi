use sqlx::PgPool;
use uuid::Uuid;

use super::models::{CreateUser, User};
use common::AppError;

/// Canonical form used for every email written to or queried from `users.email`.
/// Must be applied at every read/write boundary to keep `(tenant_id, email)`
/// uniqueness case-insensitive in practice.
pub fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

pub async fn create_user(pool: &PgPool, input: &CreateUser) -> Result<User, AppError> {
    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (tenant_id, email, password_hash, display_name)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        "#,
    )
    .bind(input.tenant_id)
    .bind(normalize_email(&input.email))
    .bind(&input.password_hash)
    .bind(&input.display_name)
    .fetch_one(pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(ref db_err) if db_err.is_unique_violation() => {
            AppError::Conflict("A user with this email already exists".into())
        }
        _ => AppError::Database(e.to_string()),
    })?;

    Ok(user)
}

pub async fn get_user_by_id(pool: &PgPool, id: Uuid) -> Result<User, AppError> {
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1 AND is_active = true")
        .bind(id)
        .fetch_one(pool)
        .await?;
    Ok(user)
}

/// Returns the active user for `(tenant_id, email)`, or `None` when no row matches.
pub async fn find_user_by_email(
    pool: &PgPool,
    tenant_id: Uuid,
    email: &str,
) -> Result<Option<User>, AppError> {
    let user = sqlx::query_as::<_, User>(
        "SELECT * FROM users WHERE tenant_id = $1 AND email = $2 AND is_active = true LIMIT 1",
    )
    .bind(tenant_id)
    .bind(normalize_email(email))
    .fetch_optional(pool)
    .await?;
    Ok(user)
}

/// Look up all active users with the given email across all tenants.
/// Used for login without org slug — if exactly one result, we can resolve the tenant automatically.
pub async fn find_users_by_email(pool: &PgPool, email: &str) -> Result<Vec<User>, AppError> {
    let users =
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1 AND is_active = true")
            .bind(normalize_email(email))
            .fetch_all(pool)
            .await?;
    Ok(users)
}

pub async fn list_users_by_tenant(
    pool: &PgPool,
    tenant_id: Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<User>, AppError> {
    let users = sqlx::query_as::<_, User>(
        r#"
        SELECT * FROM users
        WHERE tenant_id = $1 AND is_active = true
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;
    Ok(users)
}

pub async fn update_user_display_name(
    pool: &PgPool,
    id: Uuid,
    display_name: &str,
) -> Result<User, AppError> {
    let user = sqlx::query_as::<_, User>(
        r#"
        UPDATE users SET display_name = $2, updated_at = NOW()
        WHERE id = $1 AND is_active = true
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(display_name)
    .fetch_one(pool)
    .await?;
    Ok(user)
}

pub async fn deactivate_user(pool: &PgPool, id: Uuid) -> Result<(), AppError> {
    sqlx::query("UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}
