use axum::{
    extract::{Path, State},
    routing::get,
    Extension, Json, Router,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::alert_dispatch::deliver_channel;
use crate::state::AppState;
use auth::middleware::CurrentUser;
use common::AppError;
use db::postgres::models::{AlertChannel, IntegrationView};

#[derive(Serialize, ToSchema)]
pub struct IntegrationsResponse {
    pub data: Vec<IntegrationView>,
}

/// Which OAuth "Connect" providers are configured on this instance (i.e. the
/// operator set the client id/secret). The frontend hides buttons for the
/// unconfigured ones; webhook-paste remains available regardless.
///
/// Also returns the exact OAuth **redirect URLs** this server uses (derived from
/// `APP_BASE_URL`). Self-hosters must register these byte-for-byte in their
/// provider app (e.g. Slack → OAuth & Permissions → Redirect URLs), so the UI
/// shows them. They're returned even when creds aren't set yet, so operators can
/// register the URL before pasting their client id/secret.
#[derive(Serialize, ToSchema)]
pub struct OAuthProvidersResponse {
    pub slack: bool,
    pub discord: bool,
    pub google: bool,
    /// The redirect URL to register in the Slack app for this deployment.
    pub slack_redirect_url: String,
    /// The redirect URL to register in the Discord application for this deployment.
    pub discord_redirect_url: String,
}

#[utoipa::path(
    get,
    path = "/api/v1/integrations/providers",
    tag = "integrations",
    responses((status = 200, description = "Success", body = OAuthProvidersResponse))
)]
pub async fn oauth_providers(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<OAuthProvidersResponse>, AppError> {
    auth::rbac::check_permission(&user, "settings_read")?;
    Ok(Json(OAuthProvidersResponse {
        slack: state.config.oauth.slack.is_some(),
        discord: state.config.oauth.discord.is_some(),
        google: state.config.oauth.google.is_some(),
        slack_redirect_url: crate::oauth::redirect_uri(&state, "/integrations/slack/callback"),
        discord_redirect_url: crate::oauth::redirect_uri(&state, "/integrations/discord/callback"),
    }))
}

#[derive(Deserialize, ToSchema)]
pub struct TestIntegrationRequest {
    /// Slack only: the channel to post the test message to.
    #[serde(default)]
    pub channel_id: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct TestIntegrationResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[utoipa::path(
    get,
    path = "/api/v1/integrations",
    tag = "integrations",
    responses((status = 200, description = "Success", body = IntegrationsResponse))
)]
pub async fn list_integrations(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<IntegrationsResponse>, AppError> {
    auth::rbac::check_permission(&user, "settings_read")?;
    let rows = db::postgres::integrations::list_integrations(&state.pg, user.tenant_id).await?;
    let data = rows.iter().map(|i| i.to_view()).collect();
    Ok(Json(IntegrationsResponse { data }))
}

#[utoipa::path(
    delete,
    path = "/api/v1/integrations/{id}",
    tag = "integrations",
    params(("id" = Uuid, Path, description = "Integration ID")),
    responses((status = 204, description = "Deleted"))
)]
pub async fn delete_integration(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    auth::rbac::check_permission(&user, "settings_write")?;
    let deleted =
        db::postgres::integrations::delete_integration(&state.pg, user.tenant_id, id).await?;
    if !deleted {
        return Err(AppError::NotFound("Integration not found".into()));
    }
    // Drop any cached channel list for this integration.
    let _ = db::redis::cache::clear_slack_channels(&state.redis, id).await;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/v1/integrations/{id}/test",
    tag = "integrations",
    request_body = TestIntegrationRequest,
    params(("id" = Uuid, Path, description = "Integration ID")),
    responses((status = 200, description = "Success", body = TestIntegrationResponse))
)]
pub async fn test_integration(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<Uuid>,
    Json(req): Json<TestIntegrationRequest>,
) -> Result<Json<TestIntegrationResponse>, AppError> {
    auth::rbac::check_permission(&user, "settings_write")?;

    // IDOR guard: resolve the integration scoped to the caller's tenant.
    let integration = db::postgres::integrations::get_integration(&state.pg, user.tenant_id, id)
        .await?
        .ok_or_else(|| AppError::NotFound("Integration not found".into()))?;

    // Throttle test sends per (tenant, integration) so a session can't hammer
    // the provider API on the tenant's credential.
    if db::redis::cache::is_alert_in_cooldown(&state.redis, user.tenant_id, id)
        .await
        .unwrap_or(false)
    {
        return Err(AppError::RateLimited);
    }
    let _ = db::redis::cache::set_alert_cooldown(&state.redis, user.tenant_id, id, 5).await;

    // Build the channel for this integration's kind.
    let channel = match integration.kind.as_str() {
        "slack" => {
            let channel_id = req.channel_id.ok_or_else(|| {
                AppError::BadRequest("channel_id is required to test a Slack integration".into())
            })?;
            AlertChannel::SlackConnection {
                integration_id: id,
                channel_id,
                channel_name: String::new(),
                min_severity: None,
            }
        }
        "discord" => AlertChannel::DiscordConnection { integration_id: id, min_severity: None },
        "pagerduty" => AlertChannel::PagerDutyConnection { integration_id: id, min_severity: None },
        "webhook" => AlertChannel::WebhookConnection { integration_id: id, min_severity: None },
        other => return Err(AppError::BadRequest(format!("unknown integration kind: {other}"))),
    };

    let tenant = db::postgres::tenants::get_tenant_by_id(&state.pg, user.tenant_id).await?;
    let integrations = std::iter::once((id, integration)).collect();
    let alert = test_alert();

    let result =
        deliver_channel(&state, &state.http, &tenant, &integrations, &channel, &alert).await;
    Ok(Json(TestIntegrationResponse { success: result.success, error: result.error }))
}

/// A synthetic alert used by the "send test" endpoint.
fn test_alert() -> alerting::engine::FiredAlert {
    alerting::engine::FiredAlert {
        id: Uuid::new_v4(),
        rule_id: Uuid::nil(),
        tenant_id: Uuid::nil(),
        rule_name: "Test alert".into(),
        condition_type: Some("test".into()),
        severity: "info".into(),
        summary: "This is a test alert from Feloxi. Your integration is working.".into(),
        details: serde_json::json!({ "source": "integration test" }),
        fired_at: chrono::Utc::now().timestamp() as f64,
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/integrations", get(list_integrations))
        .route("/integrations/providers", get(oauth_providers))
        .route("/integrations/{id}", axum::routing::delete(delete_integration))
        .route("/integrations/{id}/test", axum::routing::post(test_integration))
}
