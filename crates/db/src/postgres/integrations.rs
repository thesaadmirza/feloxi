use sqlx::types::Json;
use sqlx::PgPool;
use uuid::Uuid;

use super::models::{Integration, NewIntegration};
use common::AppError;

/// List all integrations for a tenant (newest first). Includes `secret_enc` —
/// callers must project to `IntegrationView` before returning to clients.
pub async fn list_integrations(
    pool: &PgPool,
    tenant_id: Uuid,
) -> Result<Vec<Integration>, AppError> {
    let rows = sqlx::query_as::<_, Integration>(
        "SELECT * FROM integrations WHERE tenant_id = $1 ORDER BY created_at DESC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Fetch one integration scoped to its tenant (IDOR guard — always pass the
/// caller's tenant_id, never trust the id alone).
pub async fn get_integration(
    pool: &PgPool,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<Option<Integration>, AppError> {
    let row = sqlx::query_as::<_, Integration>(
        "SELECT * FROM integrations WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Load a tenant's integrations into a map keyed by id, for the eval loop.
pub async fn map_integrations(
    pool: &PgPool,
    tenant_id: Uuid,
) -> Result<std::collections::HashMap<Uuid, Integration>, AppError> {
    Ok(list_integrations(pool, tenant_id).await?.into_iter().map(|i| (i.id, i)).collect())
}

/// Insert a new integration (no dedupe). Used for kinds without a natural
/// uniqueness key (e.g. webhook/pagerduty).
pub async fn create_integration(
    pool: &PgPool,
    input: &NewIntegration,
) -> Result<Integration, AppError> {
    let row = sqlx::query_as::<_, Integration>(
        r#"
        INSERT INTO integrations (tenant_id, kind, name, config, secret_enc, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        "#,
    )
    .bind(input.tenant_id)
    .bind(&input.kind)
    .bind(&input.name)
    .bind(Json(&input.config))
    .bind(&input.secret_enc)
    .bind(input.created_by)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

/// Upsert a Slack integration keyed on `(tenant_id, config->>'team_id')` so a
/// re-install updates the existing row instead of duplicating it.
pub async fn upsert_slack_integration(
    pool: &PgPool,
    input: &NewIntegration,
) -> Result<Integration, AppError> {
    upsert_on_config_key(
        pool,
        input,
        "(tenant_id, (config ->> 'team_id'))",
        "kind = 'slack' AND config ? 'team_id'",
    )
    .await
}

/// Upsert a Discord integration keyed on `(tenant_id, config->>'channel_id')`.
pub async fn upsert_discord_integration(
    pool: &PgPool,
    input: &NewIntegration,
) -> Result<Integration, AppError> {
    upsert_on_config_key(
        pool,
        input,
        "(tenant_id, (config ->> 'channel_id'))",
        "kind = 'discord' AND config ? 'channel_id'",
    )
    .await
}

/// Shared upsert against one of the partial expression indexes. The conflict
/// target + predicate must match a partial index from migration 016 exactly so
/// Postgres can infer it. Inputs are fixed string literals from the callers
/// above — never user data.
async fn upsert_on_config_key(
    pool: &PgPool,
    input: &NewIntegration,
    conflict: &str,
    predicate: &str,
) -> Result<Integration, AppError> {
    let sql = format!(
        r#"
        INSERT INTO integrations (tenant_id, kind, name, config, secret_enc, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT {conflict} WHERE {predicate}
        DO UPDATE SET
            name = EXCLUDED.name,
            config = EXCLUDED.config,
            secret_enc = EXCLUDED.secret_enc,
            status = 'active',
            updated_at = NOW()
        RETURNING *
        "#
    );
    let row = sqlx::query_as::<_, Integration>(&sql)
        .bind(input.tenant_id)
        .bind(&input.kind)
        .bind(&input.name)
        .bind(Json(&input.config))
        .bind(&input.secret_enc)
        .bind(input.created_by)
        .fetch_one(pool)
        .await?;
    Ok(row)
}

/// Mark an integration's status (e.g. `revoked` when a token is dead).
/// Tenant-scoped so it can't be flipped cross-tenant.
pub async fn set_integration_status(
    pool: &PgPool,
    tenant_id: Uuid,
    id: Uuid,
    status: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE integrations SET status = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3",
    )
    .bind(status)
    .bind(id)
    .bind(tenant_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete an integration (tenant-scoped). Returns true if a row was removed.
pub async fn delete_integration(
    pool: &PgPool,
    tenant_id: Uuid,
    id: Uuid,
) -> Result<bool, AppError> {
    let res = sqlx::query("DELETE FROM integrations WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected() > 0)
}
