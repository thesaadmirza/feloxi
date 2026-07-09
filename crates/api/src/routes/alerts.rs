use axum::{
    extract::{Path, Query, State},
    routing::get,
    Extension, Json, Router,
};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::routes::responses::{AlertHistoryResponse, AlertRulesResponse, SilencesResponse};
use crate::state::AppState;
use auth::middleware::CurrentUser;
use common::AppError;
use db::postgres::models::{AlertChannel, AlertCondition};

#[derive(Deserialize, ToSchema)]
pub struct CreateAlertRuleRequest {
    pub name: String,
    pub description: Option<String>,
    pub condition: AlertCondition,
    pub channels: Vec<AlertChannel>,
    pub cooldown_secs: Option<i32>,
    /// Overrides the severity derived from the condition (`info` | `warning`
    /// | `critical`). Null keeps auto.
    pub severity_override: Option<String>,
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateAlertRuleRequest {
    pub name: String,
    pub description: Option<String>,
    pub condition: AlertCondition,
    pub channels: Vec<AlertChannel>,
    pub cooldown_secs: i32,
    pub is_enabled: bool,
    pub severity_override: Option<String>,
}

const SEVERITIES: [&str; 3] = ["info", "warning", "critical"];

/// Reject unknown severity strings on rule overrides and channel floors, so a
/// typo doesn't silently route everything (unknowns rank lowest).
fn validate_severities(
    severity_override: Option<&str>,
    channels: &[AlertChannel],
) -> Result<(), AppError> {
    let check = |s: &str| -> Result<(), AppError> {
        if SEVERITIES.contains(&s) {
            Ok(())
        } else {
            Err(AppError::BadRequest(format!(
                "unknown severity '{s}' (expected one of: {})",
                SEVERITIES.join(", ")
            )))
        }
    };
    if let Some(s) = severity_override {
        check(s)?;
    }
    for channel in channels {
        if let Some(s) = channel.min_severity() {
            check(s)?;
        }
    }
    Ok(())
}

/// Reject channels that reference an integration the caller's tenant does not
/// own. The eval loop already resolves channels only against the tenant's own
/// integrations (so a foreign ID is a silent no-op, not a leak), but validating
/// at write time turns that into a clear error and stops a rule from pointing at
/// an integration that does not exist.
async fn validate_channel_integrations(
    state: &AppState,
    tenant_id: Uuid,
    channels: &[AlertChannel],
) -> Result<(), AppError> {
    let referenced: Vec<Uuid> = channels.iter().filter_map(|c| c.integration_id()).collect();
    if referenced.is_empty() {
        return Ok(());
    }
    let owned: std::collections::HashSet<Uuid> =
        db::postgres::integrations::list_integrations(&state.pg, tenant_id)
            .await?
            .into_iter()
            .map(|i| i.id)
            .collect();
    if let Some(missing) = referenced.iter().find(|id| !owned.contains(id)) {
        return Err(AppError::BadRequest(format!(
            "channel references unknown integration: {missing}"
        )));
    }
    Ok(())
}

#[utoipa::path(
    get,
    path = "/api/v1/alerts/rules",
    tag = "alerts",
    responses((status = 200, description = "Success", body = AlertRulesResponse))
)]
pub async fn list_rules(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<AlertRulesResponse>, AppError> {
    auth::rbac::check_permission(&user, "alerts_read")?;
    let rules = db::postgres::alert_rules::list_alert_rules(&state.pg, user.tenant_id).await?;
    Ok(Json(AlertRulesResponse { data: rules }))
}

#[utoipa::path(
    post,
    path = "/api/v1/alerts/rules",
    tag = "alerts",
    request_body = CreateAlertRuleRequest,
    responses((status = 200, description = "Success", body = db::postgres::models::AlertRule))
)]
pub async fn create_rule(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Json(req): Json<CreateAlertRuleRequest>,
) -> Result<Json<db::postgres::models::AlertRule>, AppError> {
    auth::rbac::check_permission(&user, "alerts_write")?;
    validate_channel_integrations(&state, user.tenant_id, &req.channels).await?;
    validate_severities(req.severity_override.as_deref(), &req.channels)?;

    let rule = db::postgres::alert_rules::create_alert_rule(
        &state.pg,
        &db::postgres::models::CreateAlertRule {
            tenant_id: user.tenant_id,
            name: req.name,
            description: req.description,
            condition: req.condition,
            channels: req.channels,
            cooldown_secs: req.cooldown_secs,
            severity_override: req.severity_override,
        },
    )
    .await?;

    Ok(Json(rule))
}

#[utoipa::path(
    get,
    path = "/api/v1/alerts/rules/{rule_id}",
    tag = "alerts",
    params(("rule_id" = Uuid, Path, description = "Alert rule ID")),
    responses((status = 200, description = "Success", body = db::postgres::models::AlertRule))
)]
pub async fn get_rule(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(rule_id): Path<Uuid>,
) -> Result<Json<db::postgres::models::AlertRule>, AppError> {
    auth::rbac::check_permission(&user, "alerts_read")?;
    let rule = db::postgres::alert_rules::get_alert_rule(&state.pg, rule_id).await?;
    // Verify tenant ownership
    if rule.tenant_id != user.tenant_id {
        return Err(AppError::NotFound("Alert rule not found".into()));
    }
    Ok(Json(rule))
}

#[utoipa::path(
    put,
    path = "/api/v1/alerts/rules/{rule_id}",
    tag = "alerts",
    request_body = UpdateAlertRuleRequest,
    params(("rule_id" = Uuid, Path, description = "Alert rule ID")),
    responses((status = 200, description = "Success", body = db::postgres::models::AlertRule))
)]
pub async fn update_rule(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(rule_id): Path<Uuid>,
    Json(req): Json<UpdateAlertRuleRequest>,
) -> Result<Json<db::postgres::models::AlertRule>, AppError> {
    auth::rbac::check_permission(&user, "alerts_write")?;
    validate_channel_integrations(&state, user.tenant_id, &req.channels).await?;
    validate_severities(req.severity_override.as_deref(), &req.channels)?;

    let rule = db::postgres::alert_rules::update_alert_rule(
        &state.pg,
        user.tenant_id,
        rule_id,
        &req.name,
        req.description.as_deref(),
        &req.condition,
        &req.channels,
        req.cooldown_secs,
        req.is_enabled,
        req.severity_override.as_deref(),
    )
    .await?;

    Ok(Json(rule))
}

#[utoipa::path(
    delete,
    path = "/api/v1/alerts/rules/{rule_id}",
    tag = "alerts",
    params(("rule_id" = Uuid, Path, description = "Alert rule ID")),
    responses((status = 200, description = "Success", body = serde_json::Value))
)]
pub async fn delete_rule(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(rule_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth::rbac::check_permission(&user, "alerts_write")?;
    db::postgres::alert_rules::delete_alert_rule(&state.pg, user.tenant_id, rule_id).await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

#[derive(Deserialize, ToSchema, IntoParams)]
pub struct AlertHistoryParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[utoipa::path(
    get,
    path = "/api/v1/alerts/history",
    tag = "alerts",
    params(AlertHistoryParams),
    responses((status = 200, description = "Success", body = AlertHistoryResponse))
)]
pub async fn list_history(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Query(params): Query<AlertHistoryParams>,
) -> Result<Json<AlertHistoryResponse>, AppError> {
    auth::rbac::check_permission(&user, "alerts_read")?;

    let limit = params.limit.unwrap_or(50).clamp(1, 200);
    let offset = params.offset.unwrap_or(0).max(0);

    let total = db::postgres::alert_rules::count_alert_history(&state.pg, user.tenant_id).await?;

    let history =
        db::postgres::alert_rules::list_alert_history(&state.pg, user.tenant_id, limit, offset)
            .await?;

    let has_more = offset + limit < total;

    Ok(Json(AlertHistoryResponse { data: history, has_more, total: Some(total) }))
}

#[derive(Deserialize, ToSchema)]
pub struct CreateSilenceRequest {
    /// Rule to silence; null silences every rule in the tenant.
    pub rule_id: Option<Uuid>,
    pub reason: Option<String>,
    /// How long the silence lasts from now.
    pub duration_minutes: i64,
}

#[utoipa::path(
    get,
    path = "/api/v1/alerts/silences",
    tag = "alerts",
    responses((status = 200, description = "Success", body = SilencesResponse))
)]
pub async fn list_silences(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<SilencesResponse>, AppError> {
    auth::rbac::check_permission(&user, "alerts_read")?;
    let silences = db::postgres::silences::list_silences(&state.pg, user.tenant_id, 50).await?;
    Ok(Json(SilencesResponse { data: silences }))
}

#[utoipa::path(
    post,
    path = "/api/v1/alerts/silences",
    tag = "alerts",
    request_body = CreateSilenceRequest,
    responses((status = 200, description = "Success", body = db::postgres::models::AlertSilence))
)]
pub async fn create_silence(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Json(req): Json<CreateSilenceRequest>,
) -> Result<Json<db::postgres::models::AlertSilence>, AppError> {
    auth::rbac::check_permission(&user, "alerts_write")?;

    // 1 minute to 30 days.
    let minutes = req.duration_minutes.clamp(1, 60 * 24 * 30);
    if let Some(rule_id) = req.rule_id {
        let rule = db::postgres::alert_rules::get_alert_rule(&state.pg, rule_id).await?;
        if rule.tenant_id != user.tenant_id {
            return Err(AppError::NotFound("Alert rule not found".into()));
        }
    }

    let ends_at = chrono::Utc::now() + chrono::Duration::minutes(minutes);
    let silence = db::postgres::silences::create_silence(
        &state.pg,
        user.tenant_id,
        req.rule_id,
        req.reason.as_deref().filter(|r| !r.trim().is_empty()),
        ends_at,
        Some(user.user_id),
    )
    .await?;

    Ok(Json(silence))
}

#[utoipa::path(
    delete,
    path = "/api/v1/alerts/silences/{silence_id}",
    tag = "alerts",
    params(("silence_id" = Uuid, Path, description = "Silence ID")),
    responses((status = 200, description = "Success", body = serde_json::Value))
)]
pub async fn expire_silence(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(silence_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth::rbac::check_permission(&user, "alerts_write")?;
    let expired =
        db::postgres::silences::expire_silence(&state.pg, user.tenant_id, silence_id).await?;
    if !expired {
        return Err(AppError::NotFound("Active silence not found".into()));
    }
    Ok(Json(serde_json::json!({ "expired": true })))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/alerts/rules", get(list_rules).post(create_rule))
        .route("/alerts/rules/{rule_id}", get(get_rule).put(update_rule).delete(delete_rule))
        .route("/alerts/history", get(list_history))
        .route("/alerts/silences", get(list_silences).post(create_silence))
        .route("/alerts/silences/{silence_id}", axum::routing::delete(expire_silence))
}
