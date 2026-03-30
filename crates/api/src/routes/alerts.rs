use axum::{
    extract::{Path, Query, State},
    routing::get,
    Extension, Json, Router,
};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::routes::responses::{AlertHistoryResponse, AlertRulesResponse};
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
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateAlertRuleRequest {
    pub name: String,
    pub description: Option<String>,
    pub condition: AlertCondition,
    pub channels: Vec<AlertChannel>,
    pub cooldown_secs: i32,
    pub is_enabled: bool,
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

    let rule = db::postgres::alert_rules::create_alert_rule(
        &state.pg,
        &db::postgres::models::CreateAlertRule {
            tenant_id: user.tenant_id,
            name: req.name,
            description: req.description,
            condition: req.condition,
            channels: req.channels,
            cooldown_secs: req.cooldown_secs,
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

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/alerts/rules", get(list_rules).post(create_rule))
        .route("/alerts/rules/{rule_id}", get(get_rule).put(update_rule).delete(delete_rule))
        .route("/alerts/history", get(list_history))
}
