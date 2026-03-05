use sqlx::PgPool;
use uuid::Uuid;

use super::models::RetentionPolicy;
use common::AppError;

pub async fn list_retention_policies(
    pool: &PgPool,
    tenant_id: Uuid,
) -> Result<Vec<RetentionPolicy>, AppError> {
    let policies = sqlx::query_as::<_, RetentionPolicy>(
        "SELECT * FROM retention_policies WHERE tenant_id = $1 ORDER BY resource_type",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;
    Ok(policies)
}

pub async fn upsert_retention_policy(
    pool: &PgPool,
    tenant_id: Uuid,
    resource_type: &str,
    retention_days: i32,
) -> Result<RetentionPolicy, AppError> {
    let policy = sqlx::query_as::<_, RetentionPolicy>(
        r#"
        INSERT INTO retention_policies (tenant_id, resource_type, retention_days)
        VALUES ($1, $2, $3)
        ON CONFLICT (tenant_id, resource_type)
        DO UPDATE SET retention_days = $3, updated_at = NOW()
        RETURNING *
        "#,
    )
    .bind(tenant_id)
    .bind(resource_type)
    .bind(retention_days)
    .fetch_one(pool)
    .await?;
    Ok(policy)
}
