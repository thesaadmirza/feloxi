use sqlx::PgPool;
use uuid::Uuid;

use super::models::AlertSilence;
use common::AppError;

/// Create a silence ending at `ends_at`. `rule_id` NULL silences all rules.
pub async fn create_silence(
    pool: &PgPool,
    tenant_id: Uuid,
    rule_id: Option<Uuid>,
    reason: Option<&str>,
    ends_at: chrono::DateTime<chrono::Utc>,
    created_by: Option<Uuid>,
) -> Result<AlertSilence, AppError> {
    let silence = sqlx::query_as::<_, AlertSilence>(
        r#"
        INSERT INTO alert_silences (tenant_id, rule_id, reason, ends_at, created_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        "#,
    )
    .bind(tenant_id)
    .bind(rule_id)
    .bind(reason)
    .bind(ends_at)
    .bind(created_by)
    .fetch_one(pool)
    .await?;
    Ok(silence)
}

/// Silences that are active right now, for the eval loop.
pub async fn list_active_silences(
    pool: &PgPool,
    tenant_id: Uuid,
) -> Result<Vec<AlertSilence>, AppError> {
    let silences = sqlx::query_as::<_, AlertSilence>(
        r#"
        SELECT * FROM alert_silences
        WHERE tenant_id = $1 AND starts_at <= NOW() AND ends_at > NOW()
        "#,
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;
    Ok(silences)
}

/// Active silences plus the recent expired tail, newest first, for the UI.
pub async fn list_silences(
    pool: &PgPool,
    tenant_id: Uuid,
    limit: i64,
) -> Result<Vec<AlertSilence>, AppError> {
    let silences = sqlx::query_as::<_, AlertSilence>(
        r#"
        SELECT * FROM alert_silences
        WHERE tenant_id = $1
        ORDER BY (ends_at > NOW()) DESC, ends_at DESC
        LIMIT $2
        "#,
    )
    .bind(tenant_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(silences)
}

/// End a silence now (kept as a row for the audit trail rather than deleted).
/// Returns false if it doesn't exist or already ended.
pub async fn expire_silence(pool: &PgPool, tenant_id: Uuid, id: Uuid) -> Result<bool, AppError> {
    let result = sqlx::query(
        r#"
        UPDATE alert_silences SET ends_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND ends_at > NOW()
        "#,
    )
    .bind(id)
    .bind(tenant_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}
