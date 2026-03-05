use sqlx::PgPool;
use uuid::Uuid;

use super::models::{BrokerConfig, CreateBrokerConfig};
use common::AppError;

pub async fn create_broker_config(
    pool: &PgPool,
    input: &CreateBrokerConfig,
) -> Result<BrokerConfig, AppError> {
    let config = sqlx::query_as::<_, BrokerConfig>(
        r#"
        INSERT INTO broker_configs (tenant_id, name, broker_type, connection_enc)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        "#,
    )
    .bind(input.tenant_id)
    .bind(&input.name)
    .bind(&input.broker_type)
    .bind(&input.connection_enc)
    .fetch_one(pool)
    .await?;
    Ok(config)
}

pub async fn list_broker_configs(
    pool: &PgPool,
    tenant_id: Uuid,
) -> Result<Vec<BrokerConfig>, AppError> {
    let configs = sqlx::query_as::<_, BrokerConfig>(
        "SELECT * FROM broker_configs WHERE tenant_id = $1 ORDER BY created_at DESC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;
    Ok(configs)
}

pub async fn get_broker_config(
    pool: &PgPool,
    id: Uuid,
    tenant_id: Uuid,
) -> Result<BrokerConfig, AppError> {
    let config = sqlx::query_as::<_, BrokerConfig>(
        "SELECT * FROM broker_configs WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_one(pool)
    .await?;
    Ok(config)
}

pub async fn update_broker_config_status(
    pool: &PgPool,
    id: Uuid,
    status: &str,
    last_error: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE broker_configs SET status = $2, last_error = $3, updated_at = NOW() WHERE id = $1",
    )
    .bind(id)
    .bind(status)
    .bind(last_error)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_broker_active(
    pool: &PgPool,
    id: Uuid,
    tenant_id: Uuid,
    is_active: bool,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE broker_configs SET is_active = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(is_active)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_broker_config(
    pool: &PgPool,
    id: Uuid,
    tenant_id: Uuid,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM broker_configs WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_active_broker_configs(pool: &PgPool) -> Result<Vec<BrokerConfig>, AppError> {
    let configs =
        sqlx::query_as::<_, BrokerConfig>("SELECT * FROM broker_configs WHERE is_active = true")
            .fetch_all(pool)
            .await?;
    Ok(configs)
}
