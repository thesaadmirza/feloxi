use sqlx::types::Json;
use sqlx::PgPool;
use uuid::Uuid;

use super::models::Role;
use common::AppError;

pub async fn create_role(
    pool: &PgPool,
    tenant_id: Uuid,
    name: &str,
    permissions: &[String],
    is_system: bool,
) -> Result<Role, AppError> {
    let role = sqlx::query_as::<_, Role>(
        r#"
        INSERT INTO roles (tenant_id, name, permissions, is_system)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        "#,
    )
    .bind(tenant_id)
    .bind(name)
    .bind(Json(permissions))
    .bind(is_system)
    .fetch_one(pool)
    .await?;
    Ok(role)
}

pub async fn get_role_by_name(
    pool: &PgPool,
    tenant_id: Uuid,
    name: &str,
) -> Result<Role, AppError> {
    let role = sqlx::query_as::<_, Role>("SELECT * FROM roles WHERE tenant_id = $1 AND name = $2")
        .bind(tenant_id)
        .bind(name)
        .fetch_one(pool)
        .await?;
    Ok(role)
}

pub async fn list_roles(pool: &PgPool, tenant_id: Uuid) -> Result<Vec<Role>, AppError> {
    let roles = sqlx::query_as::<_, Role>("SELECT * FROM roles WHERE tenant_id = $1 ORDER BY name")
        .bind(tenant_id)
        .fetch_all(pool)
        .await?;
    Ok(roles)
}

pub async fn assign_role(pool: &PgPool, user_id: Uuid, role_id: Uuid) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO user_roles (user_id, role_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, role_id) DO NOTHING
        "#,
    )
    .bind(user_id)
    .bind(role_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_role(pool: &PgPool, user_id: Uuid, role_id: Uuid) -> Result<(), AppError> {
    sqlx::query("DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2")
        .bind(user_id)
        .bind(role_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_user_roles(pool: &PgPool, user_id: Uuid) -> Result<Vec<Role>, AppError> {
    let roles = sqlx::query_as::<_, Role>(
        r#"
        SELECT r.* FROM roles r
        INNER JOIN user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(roles)
}

pub async fn get_user_permissions(pool: &PgPool, user_id: Uuid) -> Result<Vec<String>, AppError> {
    let roles = get_user_roles(pool, user_id).await?;
    let mut permissions = std::collections::HashSet::new();

    for role in roles {
        for perm in role.permissions.0.iter() {
            permissions.insert(perm.clone());
        }
    }

    Ok(permissions.into_iter().collect())
}

/// Initialize system roles for a new tenant.
pub async fn init_system_roles(pool: &PgPool, tenant_id: Uuid) -> Result<(), AppError> {
    let system_roles: Vec<(&str, Vec<String>)> = vec![
        (
            "admin",
            vec![
                "tasks_read",
                "tasks_retry",
                "tasks_revoke",
                "workers_read",
                "workers_shutdown",
                "alerts_read",
                "alerts_write",
                "beat_read",
                "metrics_read",
                "settings_read",
                "settings_write",
                "team_manage",
                "api_keys_manage",
                "brokers_manage",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
        ),
        (
            "editor",
            vec![
                "tasks_read",
                "tasks_retry",
                "workers_read",
                "alerts_read",
                "alerts_write",
                "beat_read",
                "metrics_read",
                "settings_read",
                "api_keys_manage",
                "brokers_manage",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
        ),
        (
            "viewer",
            vec!["tasks_read", "workers_read", "alerts_read", "beat_read", "metrics_read"]
                .into_iter()
                .map(String::from)
                .collect(),
        ),
        ("readonly", vec!["tasks_read", "workers_read"].into_iter().map(String::from).collect()),
    ];

    for (name, permissions) in &system_roles {
        create_role(pool, tenant_id, name, permissions, true).await?;
    }

    Ok(())
}
