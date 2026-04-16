use axum::{
    extract::{Path, State},
    routing::{delete, get, post},
    Extension, Json, Router,
};
use chrono::{Duration, Utc};
use serde::Deserialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::routes::responses::{
    InviteMemberResponse, NotificationSettings, RetentionResponse, TeamMember, TeamResponse,
};
use crate::state::AppState;
use auth::middleware::CurrentUser;
use common::AppError;

const INVITE_EXPIRY_DAYS: i64 = 7;

#[utoipa::path(
    get,
    path = "/api/v1/settings",
    tag = "settings",
    responses((status = 200, description = "Success", body = db::postgres::models::Tenant))
)]
pub async fn get_settings(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<db::postgres::models::Tenant>, AppError> {
    auth::rbac::check_permission(&user, "settings_read")?;
    let tenant = db::postgres::tenants::get_tenant_by_id(&state.pg, user.tenant_id).await?;
    Ok(Json(tenant))
}

#[utoipa::path(
    get,
    path = "/api/v1/team",
    tag = "settings",
    responses((status = 200, description = "Success", body = TeamResponse))
)]
pub async fn get_team(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<TeamResponse>, AppError> {
    auth::rbac::check_permission(&user, "team_manage")?;
    let users =
        db::postgres::users::list_users_by_tenant(&state.pg, user.tenant_id, 100, 0).await?;
    let roles = db::postgres::rbac::list_roles(&state.pg, user.tenant_id).await?;

    // Build members with their roles included
    let mut members = Vec::new();
    for u in users {
        let user_roles = db::postgres::rbac::get_user_roles(&state.pg, u.id).await?;
        let role_names: Vec<String> = user_roles.iter().map(|r| r.name.clone()).collect();
        members.push(TeamMember {
            id: u.id,
            email: u.email,
            display_name: u.display_name,
            is_active: u.is_active,
            created_at: u.created_at,
            roles: role_names,
        });
    }

    Ok(Json(TeamResponse { members, roles }))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct InviteMemberRequest {
    pub email: String,
    pub role: String,
}

#[utoipa::path(
    post,
    path = "/api/v1/team/members",
    tag = "settings",
    request_body = InviteMemberRequest,
    responses((status = 200, description = "Success", body = InviteMemberResponse))
)]
pub async fn invite_member(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Json(req): Json<InviteMemberRequest>,
) -> Result<Json<InviteMemberResponse>, AppError> {
    auth::rbac::check_permission(&user, "team_manage")?;

    let email = db::postgres::users::normalize_email(&req.email);
    if !is_valid_email(&email) {
        return Err(AppError::Validation("A valid email address is required".into()));
    }

    // user-exists and role-exists checks are independent — run them in parallel.
    let (existing_user, _role) = tokio::try_join!(
        db::postgres::users::find_user_by_email(&state.pg, user.tenant_id, &email),
        db::postgres::rbac::get_role_by_name(&state.pg, user.tenant_id, &req.role),
    )?;
    if existing_user.is_some() {
        return Err(AppError::Conflict(
            "A user with this email already exists in this organization".into(),
        ));
    }

    // Raw token is shown once (in the URL); only the sha256 hash is persisted,
    // mirroring the API key scheme in auth::api_key.
    let token = format!("fp_inv_{}", Uuid::new_v4().simple());
    let token_hash = auth::api_key::hash_api_key(&token);
    let expires_at = Utc::now() + Duration::days(INVITE_EXPIRY_DAYS);

    let invite = db::postgres::user_invites::create_invite(
        &state.pg,
        &db::postgres::models::CreateUserInvite {
            tenant_id: user.tenant_id,
            email: email.clone(),
            role_name: req.role.clone(),
            token_hash,
            invited_by: Some(user.user_id),
            expires_at,
        },
    )
    .await?;

    let invite_url =
        format!("{}/auth/accept-invite/{}", state.config.app_base_url.trim_end_matches('/'), token);

    let tenant = db::postgres::tenants::get_tenant_by_id(&state.pg, user.tenant_id).await?;

    // Best-effort email delivery — always return the URL so the admin has a
    // manual fallback when SMTP is unconfigured or unreachable.
    let (email_sent, email_error) =
        match send_invite_email(&tenant, &email, &invite_url, &req.role).await {
            Ok(()) => (true, None),
            Err(e) => {
                tracing::warn!(error = %e, email = %email, "Invite email delivery failed");
                (false, Some(e))
            }
        };

    Ok(Json(InviteMemberResponse {
        invite_id: invite.id,
        email: invite.email,
        role: invite.role_name,
        invite_url,
        expires_at: invite.expires_at,
        email_sent,
        email_error,
    }))
}

fn is_valid_email(email: &str) -> bool {
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.is_empty() && domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
}

async fn send_invite_email(
    tenant: &db::postgres::models::Tenant,
    to: &str,
    invite_url: &str,
    role: &str,
) -> Result<(), String> {
    let smtp_config = crate::smtp::tenant_smtp_config(tenant);
    if smtp_config.host.is_empty() {
        return Err("SMTP not configured for this organization".into());
    }

    let subject = format!("You've been invited to {} on Feloxi", tenant.name);
    let html = format!(
        r#"<!DOCTYPE html>
<html><body style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #18181b;">
  <h2 style="margin: 0 0 16px;">You're invited to {tenant}</h2>
  <p style="line-height: 1.55;">You've been invited to join <strong>{tenant}</strong> on Feloxi as a <strong>{role}</strong>.</p>
  <p style="margin: 24px 0;">
    <a href="{url}" style="display: inline-block; padding: 12px 20px; background: #18181b; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 500;">Accept invitation</a>
  </p>
  <p style="color: #71717a; font-size: 13px; line-height: 1.55;">Or copy and paste this link into your browser:<br><span style="word-break: break-all;">{url}</span></p>
  <p style="color: #71717a; font-size: 13px;">This link expires in {days} days.</p>
</body></html>"#,
        tenant = html_escape(&tenant.name),
        role = html_escape(role),
        url = html_escape(invite_url),
        days = INVITE_EXPIRY_DAYS,
    );

    alerting::channels::email::send_email(&[to.to_string()], &subject, html, &smtp_config).await
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[utoipa::path(
    delete,
    path = "/api/v1/team/members/{member_id}",
    tag = "settings",
    params(("member_id" = Uuid, Path, description = "Member ID")),
    responses((status = 200, description = "Success", body = serde_json::Value))
)]
pub async fn remove_member(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(member_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth::rbac::check_permission(&user, "team_manage")?;

    // Prevent removing yourself
    if member_id == user.user_id {
        return Err(AppError::Validation("Cannot remove yourself".into()));
    }

    // Verify the user belongs to this tenant
    let target = db::postgres::users::get_user_by_id(&state.pg, member_id).await?;
    if target.tenant_id != user.tenant_id {
        return Err(AppError::NotFound("User not found".into()));
    }

    db::postgres::users::deactivate_user(&state.pg, member_id).await?;

    Ok(Json(serde_json::json!({ "removed": true })))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ResetMemberPasswordRequest {
    pub password: String,
}

#[utoipa::path(
    post,
    path = "/api/v1/team/members/{member_id}/password",
    tag = "settings",
    params(("member_id" = Uuid, Path, description = "Member ID")),
    request_body = ResetMemberPasswordRequest,
    responses((status = 200, description = "Success", body = serde_json::Value))
)]
pub async fn reset_member_password(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(member_id): Path<Uuid>,
    Json(req): Json<ResetMemberPasswordRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth::rbac::check_permission(&user, "team_manage")?;
    auth::password::validate_password(&req.password)?;

    let password_hash = auth::password::hash_password(&req.password)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    db::postgres::users::update_password_hash(&state.pg, member_id, user.tenant_id, &password_hash)
        .await?;
    db::postgres::refresh_tokens::revoke_all_for_user(&state.pg, member_id).await?;

    Ok(Json(serde_json::json!({ "reset": true })))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RetentionInput {
    pub task_events_days: i32,
    pub worker_events_days: i32,
    pub alert_history_days: i32,
}

#[utoipa::path(
    get,
    path = "/api/v1/settings/retention",
    tag = "settings",
    responses((status = 200, description = "Success", body = RetentionResponse))
)]
pub async fn get_retention(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<RetentionResponse>, AppError> {
    auth::rbac::check_permission(&user, "settings_read")?;
    let policies =
        db::postgres::retention::list_retention_policies(&state.pg, user.tenant_id).await?;

    let mut task_events_days = 30;
    let mut worker_events_days = 14;
    let mut alert_history_days = 90;

    for p in &policies {
        match p.resource_type.as_str() {
            "task_events" => task_events_days = p.retention_days,
            "worker_events" => worker_events_days = p.retention_days,
            "alert_history" => alert_history_days = p.retention_days,
            _ => {}
        }
    }

    Ok(Json(RetentionResponse { task_events_days, worker_events_days, alert_history_days }))
}

#[utoipa::path(
    put,
    path = "/api/v1/settings/retention",
    tag = "settings",
    request_body = RetentionInput,
    responses((status = 200, description = "Success", body = RetentionResponse))
)]
pub async fn update_retention(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Json(input): Json<RetentionInput>,
) -> Result<Json<RetentionResponse>, AppError> {
    auth::rbac::check_permission(&user, "settings_write")?;

    if input.task_events_days < 1 || input.worker_events_days < 1 || input.alert_history_days < 1 {
        return Err(AppError::Validation("Retention days must be at least 1".into()));
    }

    let resources = [
        ("task_events", input.task_events_days),
        ("worker_events", input.worker_events_days),
        ("alert_history", input.alert_history_days),
    ];

    for (resource_type, days) in &resources {
        db::postgres::retention::upsert_retention_policy(
            &state.pg,
            user.tenant_id,
            resource_type,
            *days,
        )
        .await?;
    }

    Ok(Json(RetentionResponse {
        task_events_days: input.task_events_days,
        worker_events_days: input.worker_events_days,
        alert_history_days: input.alert_history_days,
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/settings/notifications",
    tag = "settings",
    responses((status = 200, description = "Success", body = NotificationSettings))
)]
pub async fn get_notifications(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<NotificationSettings>, AppError> {
    auth::rbac::check_permission(&user, "settings_read")?;
    let tenant = db::postgres::tenants::get_tenant_by_id(&state.pg, user.tenant_id).await?;

    let mut settings: NotificationSettings = tenant
        .settings
        .get("notifications")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // Mask password but indicate if one is set
    settings.smtp.has_password = !settings.smtp.password.is_empty();
    settings.smtp.password = String::new();

    Ok(Json(settings))
}

#[utoipa::path(
    put,
    path = "/api/v1/settings/notifications",
    tag = "settings",
    request_body = NotificationSettings,
    responses((status = 200, description = "Success", body = NotificationSettings))
)]
pub async fn update_notifications(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Json(input): Json<NotificationSettings>,
) -> Result<Json<NotificationSettings>, AppError> {
    auth::rbac::check_permission(&user, "settings_write")?;
    let tenant = db::postgres::tenants::get_tenant_by_id(&state.pg, user.tenant_id).await?;

    let mut current_settings = tenant.settings.clone();

    // If password is empty in the input, preserve the existing password
    let mut to_store = input.clone();
    if to_store.smtp.password.is_empty() {
        let existing: NotificationSettings = current_settings
            .get("notifications")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        to_store.smtp.password = existing.smtp.password;
    }

    current_settings["notifications"] = serde_json::to_value(&to_store)
        .map_err(|e| AppError::Internal(format!("Failed to serialize notifications: {e}")))?;

    db::postgres::tenants::update_tenant_settings(&state.pg, user.tenant_id, &current_settings)
        .await?;

    // Return with password masked
    let mut response = to_store;
    response.smtp.has_password = !response.smtp.password.is_empty();
    response.smtp.password = String::new();

    Ok(Json(response))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct TestNotificationRequest {
    pub channel: String,
    pub to: Option<String>,
}

#[utoipa::path(
    post,
    path = "/api/v1/settings/notifications/test",
    tag = "settings",
    request_body = TestNotificationRequest,
    responses((status = 200, description = "Success", body = serde_json::Value))
)]
pub async fn test_notification(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Json(req): Json<TestNotificationRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth::rbac::check_permission(&user, "settings_write")?;
    let tenant = db::postgres::tenants::get_tenant_by_id(&state.pg, user.tenant_id).await?;

    let notif_settings: NotificationSettings = tenant
        .settings
        .get("notifications")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    match req.channel.as_str() {
        "email" => {
            let smtp = &notif_settings.smtp;
            if smtp.host.is_empty() {
                return Err(AppError::Validation(
                    "SMTP is not configured. Save your SMTP settings first.".into(),
                ));
            }
            let recipient = req.to.unwrap_or_else(|| smtp.from_address.clone());
            let smtp_config = alerting::channels::email::SmtpConfig {
                host: smtp.host.clone(),
                port: smtp.port,
                username: smtp.username.clone(),
                password: smtp.password.clone(),
                from_address: smtp.from_address.clone(),
                tls: smtp.tls,
            };
            let test_alert = alerting::engine::FiredAlert {
                id: uuid::Uuid::new_v4(),
                rule_id: uuid::Uuid::nil(),
                tenant_id: user.tenant_id,
                rule_name: "Test Notification".into(),
                condition_type: None,
                severity: "info".into(),
                summary: "This is a test email from Feloxi to verify your SMTP configuration."
                    .into(),
                details: serde_json::json!({"test": true}),
                fired_at: chrono::Utc::now().timestamp() as f64,
            };
            let result = alerting::channels::email::send_email_alert(
                &[recipient],
                &test_alert,
                &smtp_config,
            )
            .await;
            if result.success {
                Ok(Json(
                    serde_json::json!({ "success": true, "message": "Test email sent successfully" }),
                ))
            } else {
                Err(AppError::Internal(result.error.unwrap_or_else(|| "Unknown error".into())))
            }
        }
        _ => Err(AppError::Validation(format!("Unsupported test channel: {}", req.channel))),
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/settings", get(get_settings))
        .route("/settings/retention", get(get_retention).put(update_retention))
        .route("/settings/notifications", get(get_notifications).put(update_notifications))
        .route("/settings/notifications/test", post(test_notification))
        .route("/team", get(get_team))
        .route("/team/members", post(invite_member))
        .route("/team/members/{member_id}", delete(remove_member))
        .route("/team/members/{member_id}/password", post(reset_member_password))
}
