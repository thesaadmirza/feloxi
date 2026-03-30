use std::collections::HashMap;

use sqlx::types::Json;
use sqlx::PgPool;
use uuid::Uuid;

use super::models::{
    AlertChannel, AlertCondition, AlertHistoryRow, AlertRule, ChannelDeliveryStatus,
    CreateAlertRule,
};
use common::AppError;

pub async fn create_alert_rule(
    pool: &PgPool,
    input: &CreateAlertRule,
) -> Result<AlertRule, AppError> {
    let rule = sqlx::query_as::<_, AlertRule>(
        r#"
        INSERT INTO alert_rules (tenant_id, name, description, condition, channels, cooldown_secs)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        "#,
    )
    .bind(input.tenant_id)
    .bind(&input.name)
    .bind(&input.description)
    .bind(Json(&input.condition))
    .bind(Json(&input.channels))
    .bind(input.cooldown_secs.unwrap_or(300))
    .fetch_one(pool)
    .await?;
    Ok(rule)
}

pub async fn get_alert_rule(pool: &PgPool, id: Uuid) -> Result<AlertRule, AppError> {
    let rule = sqlx::query_as::<_, AlertRule>("SELECT * FROM alert_rules WHERE id = $1")
        .bind(id)
        .fetch_one(pool)
        .await?;
    Ok(rule)
}

pub async fn list_alert_rules(pool: &PgPool, tenant_id: Uuid) -> Result<Vec<AlertRule>, AppError> {
    let rules = sqlx::query_as::<_, AlertRule>(
        "SELECT * FROM alert_rules WHERE tenant_id = $1 ORDER BY created_at DESC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;
    Ok(rules)
}

pub async fn list_enabled_alert_rules(
    pool: &PgPool,
    tenant_id: Uuid,
) -> Result<Vec<AlertRule>, AppError> {
    let rules = sqlx::query_as::<_, AlertRule>(
        "SELECT * FROM alert_rules WHERE tenant_id = $1 AND is_enabled = true",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;
    Ok(rules)
}

#[allow(clippy::too_many_arguments)]
pub async fn update_alert_rule(
    pool: &PgPool,
    tenant_id: Uuid,
    id: Uuid,
    name: &str,
    description: Option<&str>,
    condition: &AlertCondition,
    channels: &[AlertChannel],
    cooldown_secs: i32,
    is_enabled: bool,
) -> Result<AlertRule, AppError> {
    let rule = sqlx::query_as::<_, AlertRule>(
        r#"
        UPDATE alert_rules
        SET name = $3, description = $4, condition = $5, channels = $6,
            cooldown_secs = $7, is_enabled = $8, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(description)
    .bind(Json(condition))
    .bind(Json(channels))
    .bind(cooldown_secs)
    .bind(is_enabled)
    .fetch_one(pool)
    .await?;
    Ok(rule)
}

pub async fn delete_alert_rule(pool: &PgPool, tenant_id: Uuid, id: Uuid) -> Result<(), AppError> {
    sqlx::query("DELETE FROM alert_rules WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn record_alert_fired(
    pool: &PgPool,
    tenant_id: Uuid,
    rule_id: Uuid,
    severity: &str,
    summary: &str,
    details: &HashMap<String, serde_json::Value>,
    channels_sent: &HashMap<String, ChannelDeliveryStatus>,
) -> Result<AlertHistoryRow, AppError> {
    let row = sqlx::query_as::<_, AlertHistoryRow>(
        r#"
        INSERT INTO alert_history (tenant_id, rule_id, severity, summary, details, channels_sent)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        "#,
    )
    .bind(tenant_id)
    .bind(rule_id)
    .bind(severity)
    .bind(summary)
    .bind(Json(details))
    .bind(Json(channels_sent))
    .fetch_one(pool)
    .await?;

    // Update last_fired_at on the rule
    sqlx::query("UPDATE alert_rules SET last_fired_at = NOW() WHERE id = $1")
        .bind(rule_id)
        .execute(pool)
        .await?;

    Ok(row)
}

pub async fn count_alert_history(pool: &PgPool, tenant_id: Uuid) -> Result<i64, AppError> {
    let (count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM alert_history WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_one(pool)
            .await?;
    Ok(count)
}

pub async fn list_alert_history(
    pool: &PgPool,
    tenant_id: Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<AlertHistoryRow>, AppError> {
    let history = sqlx::query_as::<_, AlertHistoryRow>(
        r#"
        SELECT * FROM alert_history
        WHERE tenant_id = $1
        ORDER BY fired_at DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;
    Ok(history)
}
