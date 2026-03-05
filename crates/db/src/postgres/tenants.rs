use sqlx::PgPool;
use uuid::Uuid;

use super::models::{CreateTenant, Tenant};
use common::AppError;

pub async fn create_tenant(pool: &PgPool, input: &CreateTenant) -> Result<Tenant, AppError> {
    let tenant = sqlx::query_as::<_, Tenant>(
        r#"
        INSERT INTO tenants (name, slug, plan)
        VALUES ($1, $2, $3)
        RETURNING *
        "#,
    )
    .bind(&input.name)
    .bind(&input.slug)
    .bind(input.plan.as_deref().unwrap_or("free"))
    .fetch_one(pool)
    .await?;

    Ok(tenant)
}

pub async fn get_tenant_by_id(pool: &PgPool, id: Uuid) -> Result<Tenant, AppError> {
    let tenant = sqlx::query_as::<_, Tenant>("SELECT * FROM tenants WHERE id = $1 AND is_active = true")
        .bind(id)
        .fetch_one(pool)
        .await?;
    Ok(tenant)
}

pub async fn get_tenant_by_slug(pool: &PgPool, slug: &str) -> Result<Tenant, AppError> {
    let tenant = sqlx::query_as::<_, Tenant>("SELECT * FROM tenants WHERE slug = $1 AND is_active = true")
        .bind(slug)
        .fetch_one(pool)
        .await?;
    Ok(tenant)
}

pub async fn list_tenants(pool: &PgPool, limit: i64, offset: i64) -> Result<Vec<Tenant>, AppError> {
    let tenants = sqlx::query_as::<_, Tenant>(
        "SELECT * FROM tenants WHERE is_active = true ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;
    Ok(tenants)
}

pub async fn update_tenant_settings(
    pool: &PgPool,
    id: Uuid,
    settings: &serde_json::Value,
) -> Result<Tenant, AppError> {
    let tenant = sqlx::query_as::<_, Tenant>(
        r#"
        UPDATE tenants SET settings = $2, updated_at = NOW()
        WHERE id = $1 AND is_active = true
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(settings)
    .fetch_one(pool)
    .await?;
    Ok(tenant)
}

pub async fn deactivate_tenant(pool: &PgPool, id: Uuid) -> Result<(), AppError> {
    sqlx::query("UPDATE tenants SET is_active = false, updated_at = NOW() WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}
