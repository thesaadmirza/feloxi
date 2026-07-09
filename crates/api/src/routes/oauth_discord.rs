//! Discord OAuth install flow (incoming webhook).
//!
//! `connect` (authenticated) redirects to Discord with the `webhook.incoming`
//! scope and a signed `state` + nonce cookie; the user picks a server and
//! channel in Discord's own consent screen. `callback` (PUBLIC — the browser
//! returns via a top-level redirect with no session) verifies the state,
//! exchanges the code, and stores the returned webhook URL as an encrypted
//! `discord` integration. No channel picker is needed: the webhook is bound to
//! the channel chosen during consent.

use axum::http::header::{HeaderMap, SET_COOKIE};
use axum::{
    extract::{Query, State},
    response::{Html, IntoResponse, Redirect, Response},
    routing::get,
    Extension, Router,
};
use uuid::Uuid;

use crate::oauth::{self, err_chain};
use crate::routes::oauth_slack::CallbackParams;
use crate::state::AppState;
use auth::middleware::CurrentUser;
use common::AppError;
use db::postgres::models::NewIntegration;

const DISCORD_DOMAIN: &str = "feloxi-oauth-discord-v1";
const DISCORD_SCOPES: &str = "webhook.incoming";
const CALLBACK_PATH: &str = "/integrations/discord/callback";

fn authorize_url(state: &AppState) -> String {
    format!("{}/oauth2/authorize", state.config.discord_api_base)
}
fn token_url(state: &AppState) -> String {
    format!("{}/api/oauth2/token", state.config.discord_api_base)
}

fn popup_page(
    state: &AppState,
    ok: bool,
    integration_id: Option<Uuid>,
    error: Option<&str>,
) -> String {
    oauth::popup_page(state, "Discord", "discord-oauth", ok, integration_id, error)
}

/// GET /integrations/discord/connect — authenticated; redirects to Discord.
pub async fn discord_connect(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Response, AppError> {
    auth::rbac::check_permission(&user, "settings_write")?;
    let client = state
        .config
        .oauth
        .discord
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("Discord OAuth is not configured".into()))?;

    let (state_str, nonce) =
        oauth::build_state(&state.encryptor, DISCORD_DOMAIN, user.tenant_id, None);
    // Single-use nonce; best-effort like the Slack flow (see slack_connect).
    if let Err(e) = db::redis::cache::store_oauth_nonce(&state.redis, &nonce, 600).await {
        tracing::warn!(error = %e, "failed to store OAuth nonce (Redis unavailable)");
    }
    let redirect = oauth::redirect_uri(&state, CALLBACK_PATH);

    let url = reqwest::Url::parse_with_params(
        &authorize_url(&state),
        &[
            ("client_id", client.client_id.as_str()),
            ("scope", DISCORD_SCOPES),
            ("response_type", "code"),
            ("redirect_uri", redirect.as_str()),
            ("state", state_str.as_str()),
        ],
    )
    .map_err(|e| AppError::Internal(format!("failed to build Discord authorize URL: {e}")))?;

    let mut headers = HeaderMap::new();
    headers.insert(
        SET_COOKIE,
        oauth::set_state_cookie(&state, &nonce).parse().expect("valid cookie header"),
    );
    Ok((headers, Redirect::to(url.as_str())).into_response())
}

/// GET /integrations/discord/callback — PUBLIC. Verifies state, exchanges the
/// code, upserts the integration, and returns a popup-closing HTML page.
pub async fn discord_callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<CallbackParams>,
) -> Response {
    // Always clear the single-use state cookie on the way out.
    let mut out_headers = HeaderMap::new();
    out_headers.insert(
        SET_COOKIE,
        oauth::clear_state_cookie(&state).parse().expect("valid cookie header"),
    );

    let result = discord_callback_inner(&state, &headers, &params).await;
    let page = match &result {
        Ok(integration_id) => popup_page(&state, true, Some(*integration_id), None),
        Err(msg) => popup_page(&state, false, None, Some(msg)),
    };
    (out_headers, Html(page)).into_response()
}

async fn discord_callback_inner(
    state: &AppState,
    headers: &HeaderMap,
    params: &CallbackParams,
) -> Result<Uuid, String> {
    if let Some(err) = &params.error {
        return Err(format!("Discord authorization was declined ({err})"));
    }
    let code = params.code.as_deref().ok_or("missing authorization code")?;
    let state_str = params.state.as_deref().ok_or("missing state")?;

    let cookie_header = headers.get(axum::http::header::COOKIE).and_then(|v| v.to_str().ok());
    let nonce = oauth::cookie_value(cookie_header, oauth::STATE_COOKIE)
        .ok_or("missing state cookie — restart the connection")?;

    let verified = oauth::verify_state(&state.encryptor, DISCORD_DOMAIN, state_str, nonce)
        .ok_or("invalid or expired state")?;

    // Single-use server-side; fall open on Redis failure (same reasoning as the
    // Slack callback: HMAC state + cookie still cover CSRF, and the Discord
    // authorization code is itself single-use).
    match db::redis::cache::consume_oauth_nonce(&state.redis, &verified.nonce).await {
        Ok(true) => {}
        Ok(false) => return Err("state already used or expired".into()),
        Err(e) => {
            tracing::warn!(error = %e, "OAuth nonce check skipped (Redis unavailable)");
        }
    }

    let client = state.config.oauth.discord.as_ref().ok_or("Discord OAuth not configured")?;
    let redirect = oauth::redirect_uri(state, CALLBACK_PATH);

    let resp = match state
        .http
        .post(token_url(state))
        .basic_auth(&client.client_id, Some(&client.client_secret))
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect.as_str()),
        ])
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %err_chain(&e), "Discord token exchange request failed");
            return Err(format!("Discord token exchange failed: {}", e.without_url()));
        }
    };

    let status = resp.status();
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let code = body
            .get("error_description")
            .or_else(|| body.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown_error");
        return Err(format!("Discord rejected the connection: {code}"));
    }

    // With scope webhook.incoming, the token response carries the webhook the
    // user created in the consent screen. Its URL is the delivery secret.
    let webhook = body.get("webhook").ok_or("no webhook in Discord response")?;
    let webhook_url =
        webhook.get("url").and_then(|v| v.as_str()).ok_or("no webhook URL in response")?;
    let channel_id = webhook.get("channel_id").and_then(|v| v.as_str()).unwrap_or_default();
    let guild_id = webhook.get("guild_id").and_then(|v| v.as_str()).unwrap_or_default();
    let webhook_name =
        webhook.get("name").and_then(|v| v.as_str()).unwrap_or("Discord webhook").to_string();

    if channel_id.is_empty() {
        return Err("Discord response missing channel id".into());
    }

    let secret_enc = state.encryptor.encrypt_str(webhook_url).map_err(|e| e.to_string())?;
    let config = serde_json::json!({
        "channel_id": channel_id,
        "guild_id": guild_id,
        "webhook_id": webhook.get("id").and_then(|v| v.as_str()).unwrap_or_default(),
    });

    let integration = db::postgres::integrations::upsert_discord_integration(
        &state.pg,
        &NewIntegration {
            tenant_id: verified.tid,
            kind: "discord".into(),
            name: webhook_name,
            config,
            secret_enc,
            created_by: None,
        },
    )
    .await
    .map_err(|e| format!("failed to save integration: {e}"))?;

    Ok(integration.id)
}

pub fn protected_router() -> Router<AppState> {
    Router::new().route("/integrations/discord/connect", get(discord_connect))
}

pub fn public_router() -> Router<AppState> {
    Router::new().route("/integrations/discord/callback", get(discord_callback))
}
