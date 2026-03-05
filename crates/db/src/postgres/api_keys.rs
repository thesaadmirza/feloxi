use sqlx::types::Json;
use sqlx::PgPool;
use uuid::Uuid;

use super::models::{ApiKey, CreateApiKey};
use common::AppError;

pub async fn create_api_key(pool: &PgPool, input: &CreateApiKey) -> Result<ApiKey, AppError> {
    let key = sqlx::query_as::<_, ApiKey>(
        r#"
        INSERT INTO api_keys (tenant_id, created_by, name, key_prefix, key_hash, permissions, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.created_by)
    .bind(&input.name)
    .bind(&input.key_prefix)
    .bind(&input.key_hash)
    .bind(Json(&input.permissions))
    .bind(input.expires_at)
    .fetch_one(pool)
    .await?;
    Ok(key)
}

pub async fn get_api_key_by_prefix(pool: &PgPool, prefix: &str) -> Result<ApiKey, AppError> {
    let key = sqlx::query_as::<_, ApiKey>(
        "SELECT * FROM api_keys WHERE key_prefix = $1 AND is_active = true",
    )
    .bind(prefix)
    .fetch_one(pool)
    .await?;
    Ok(key)
}

pub async fn list_api_keys(pool: &PgPool, tenant_id: Uuid) -> Result<Vec<ApiKey>, AppError> {
    let keys = sqlx::query_as::<_, ApiKey>(
        "SELECT * FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;
    Ok(keys)
}

pub async fn revoke_api_key(pool: &PgPool, id: Uuid) -> Result<(), AppError> {
    sqlx::query("UPDATE api_keys SET is_active = false WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_last_used(pool: &PgPool, id: Uuid) -> Result<(), AppError> {
    sqlx::query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}
