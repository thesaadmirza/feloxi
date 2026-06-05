//! Slack OAuth v2 install flow + channel picker.
//!
//! `connect` (authenticated) redirects to Slack with a signed `state` + nonce
//! cookie; `callback` (PUBLIC — the browser returns via a top-level redirect
//! with no session) verifies the state, exchanges the code for a bot token,
//! and upserts an encrypted `slack` integration; `channels` lists the
//! workspace's channels (cursor-paginated) for the rule-editor picker.

use axum::http::header::{HeaderMap, SET_COOKIE};
use axum::{
    extract::{Path, Query, State},
    response::{Html, IntoResponse, Redirect, Response},
    routing::get,
    Extension, Json, Router,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::oauth;
use crate::state::AppState;
use auth::middleware::CurrentUser;
use common::AppError;
use db::postgres::models::NewIntegration;

const SLACK_DOMAIN: &str = "feloxi-oauth-slack-v1";
const SLACK_SCOPES: &str = "chat:write,chat:write.public,channels:read,groups:read";
const CALLBACK_PATH: &str = "/integrations/slack/callback";

/// Flatten an error's full `source` chain into one string for logging.
fn err_chain(e: &dyn std::error::Error) -> String {
    let mut parts = vec![e.to_string()];
    let mut src = e.source();
    while let Some(s) = src {
        parts.push(s.to_string());
        src = s.source();
    }
    parts.join(" -> ")
}

fn authorize_url(state: &AppState) -> String {
    format!("{}/oauth/v2/authorize", state.config.slack_api_base)
}
fn access_url(state: &AppState) -> String {
    format!("{}/api/oauth.v2.access", state.config.slack_api_base)
}
fn conversations_url(state: &AppState) -> String {
    format!("{}/api/conversations.list", state.config.slack_api_base)
}

/// GET /integrations/slack/connect — authenticated; redirects to Slack.
pub async fn slack_connect(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Response, AppError> {
    auth::rbac::check_permission(&user, "settings_write")?;
    let client = state
        .config
        .oauth
        .slack
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("Slack OAuth is not configured".into()))?;

    let (state_str, nonce) =
        oauth::build_state(&state.encryptor, SLACK_DOMAIN, user.tenant_id, None);
    // Record the nonce so the callback can enforce single-use (anti-replay).
    let _ = db::redis::cache::store_oauth_nonce(&state.redis, &nonce, 600).await;
    let redirect = oauth::redirect_uri(&state, CALLBACK_PATH);

    let url = reqwest::Url::parse_with_params(
        &authorize_url(&state),
        &[
            ("client_id", client.client_id.as_str()),
            ("scope", SLACK_SCOPES),
            ("redirect_uri", redirect.as_str()),
            ("state", state_str.as_str()),
        ],
    )
    .map_err(|e| AppError::Internal(format!("failed to build Slack authorize URL: {e}")))?;

    let mut headers = HeaderMap::new();
    headers.insert(
        SET_COOKIE,
        oauth::set_state_cookie(&state, &nonce).parse().expect("valid cookie header"),
    );
    Ok((headers, Redirect::to(url.as_str())).into_response())
}

#[derive(Deserialize)]
pub struct CallbackParams {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

/// GET /integrations/slack/callback — PUBLIC. Verifies state, exchanges the
/// code, upserts the integration, and returns a popup-closing HTML page.
pub async fn slack_callback(
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

    let result = slack_callback_inner(&state, &headers, &params).await;
    let page = match &result {
        Ok(integration_id) => popup_page(&state, true, Some(*integration_id), None),
        Err(msg) => popup_page(&state, false, None, Some(msg)),
    };
    (out_headers, Html(page)).into_response()
}

async fn slack_callback_inner(
    state: &AppState,
    headers: &HeaderMap,
    params: &CallbackParams,
) -> Result<Uuid, String> {
    if let Some(err) = &params.error {
        return Err(format!("Slack authorization was declined ({err})"));
    }
    let code = params.code.as_deref().ok_or("missing authorization code")?;
    let state_str = params.state.as_deref().ok_or("missing state")?;

    let cookie_header = headers.get(axum::http::header::COOKIE).and_then(|v| v.to_str().ok());
    let nonce = oauth::cookie_value(cookie_header, oauth::STATE_COOKIE)
        .ok_or("missing state cookie — restart the connection")?;

    let verified = oauth::verify_state(&state.encryptor, SLACK_DOMAIN, state_str, nonce)
        .ok_or("invalid or expired state")?;

    // Enforce single-use server-side: a replayed (state, cookie) pair fails here
    // even within the signature TTL.
    if !db::redis::cache::consume_oauth_nonce(&state.redis, &verified.nonce).await.unwrap_or(false)
    {
        return Err("state already used or expired".into());
    }

    let client = state.config.oauth.slack.as_ref().ok_or("Slack OAuth not configured")?;
    let redirect = oauth::redirect_uri(state, CALLBACK_PATH);

    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = match http
        .post(access_url(state))
        .basic_auth(&client.client_id, Some(&client.client_secret))
        .form(&[("code", code), ("redirect_uri", redirect.as_str())])
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            // Log the full source chain server-side; the popup only gets a summary.
            tracing::warn!(error = %err_chain(&e), "Slack token exchange request failed");
            return Err(format!("Slack token exchange failed: {}", e.without_url()));
        }
    };

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if !body.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let code = body.get("error").and_then(|v| v.as_str()).unwrap_or("unknown_error");
        return Err(format!("Slack rejected the connection: {code}"));
    }

    // Bot token is the TOP-LEVEL access_token (token_type=bot), NOT authed_user.
    let bot_token =
        body.get("access_token").and_then(|v| v.as_str()).ok_or("no bot token in response")?;
    let team_id = body.pointer("/team/id").and_then(|v| v.as_str()).unwrap_or_default();
    let team_name =
        body.pointer("/team/name").and_then(|v| v.as_str()).unwrap_or("Slack workspace");
    let enterprise_id = body.pointer("/enterprise/id").and_then(|v| v.as_str());

    if team_id.is_empty() {
        return Err("Slack response missing team id".into());
    }

    let secret_enc = state.encryptor.encrypt_str(bot_token).map_err(|e| e.to_string())?;
    let mut config = serde_json::json!({ "team_id": team_id, "team_name": team_name });
    if let Some(eid) = enterprise_id {
        config["enterprise_id"] = serde_json::json!(eid);
    }

    let integration = db::postgres::integrations::upsert_slack_integration(
        &state.pg,
        &NewIntegration {
            tenant_id: verified.tid,
            kind: "slack".into(),
            name: team_name.to_string(),
            config,
            secret_enc,
            created_by: None,
        },
    )
    .await
    .map_err(|e| format!("failed to save integration: {e}"))?;

    Ok(integration.id)
}

#[derive(Serialize, ToSchema)]
pub struct SlackChannel {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, ToSchema)]
pub struct SlackChannelsResponse {
    pub data: Vec<SlackChannel>,
}

/// GET /integrations/{id}/slack/channels — authenticated; paginated channel list.
#[utoipa::path(
    get,
    path = "/api/v1/integrations/{id}/slack/channels",
    tag = "integrations",
    params(("id" = Uuid, Path, description = "Slack integration ID")),
    responses((status = 200, description = "Success", body = SlackChannelsResponse))
)]
pub async fn slack_channels(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<SlackChannelsResponse>, AppError> {
    auth::rbac::check_permission(&user, "settings_read")?;
    let integration = db::postgres::integrations::get_integration(&state.pg, user.tenant_id, id)
        .await?
        .ok_or_else(|| AppError::NotFound("Integration not found".into()))?;
    if integration.kind != "slack" {
        return Err(AppError::BadRequest("Not a Slack integration".into()));
    }
    let blob = integration
        .secret_enc
        .as_deref()
        .ok_or_else(|| AppError::Internal("integration has no token".into()))?;
    let token = state
        .encryptor
        .decrypt_str(blob)
        .map_err(|_| AppError::Internal("failed to decrypt Slack token".into()))?;

    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let mut channels = Vec::new();
    let mut cursor = String::new();
    // Cap pages to bound very large (Enterprise Grid) workspaces.
    for _ in 0..50 {
        let mut req = http.get(conversations_url(&state)).bearer_auth(&token).query(&[
            ("types", "public_channel,private_channel"),
            ("exclude_archived", "true"),
            ("limit", "200"),
        ]);
        if !cursor.is_empty() {
            req = req.query(&[("cursor", cursor.as_str())]);
        }
        let body: serde_json::Value = req
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Slack API error: {}", e.without_url())))?
            .json()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        if !body.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
            let code = body.get("error").and_then(|v| v.as_str()).unwrap_or("unknown_error");
            return Err(AppError::Internal(format!("Slack conversations.list failed: {code}")));
        }

        if let Some(arr) = body.get("channels").and_then(|v| v.as_array()) {
            for ch in arr {
                if let (Some(cid), Some(name)) =
                    (ch.get("id").and_then(|v| v.as_str()), ch.get("name").and_then(|v| v.as_str()))
                {
                    channels.push(SlackChannel { id: cid.to_string(), name: name.to_string() });
                }
            }
        }

        cursor = body
            .pointer("/response_metadata/next_cursor")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if cursor.is_empty() {
            break;
        }
    }

    channels.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Json(SlackChannelsResponse { data: channels }))
}

/// Render a tiny HTML page that posts the result to the opener and closes.
fn popup_page(
    state: &AppState,
    ok: bool,
    integration_id: Option<Uuid>,
    error: Option<&str>,
) -> String {
    let origin = state.config.app_base_url.trim_end_matches('/');
    // The `error` string can contain attacker-controlled content (the public
    // callback reflects Slack's `?error=` param). Serialize to JSON, then escape
    // the sequences that could break out of the inline <script> / HTML context.
    let payload = escape_for_script(
        &serde_json::json!({
            "type": "slack-oauth",
            "ok": ok,
            "integrationId": integration_id,
            "error": error,
        })
        .to_string(),
    );
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><title>Slack</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"></head>
<body style="font-family:system-ui;padding:2rem">
<p>{msg}. You can close this window.</p>
<script>
  try {{ if (window.opener) window.opener.postMessage({payload}, {origin:?}); }} catch (e) {{}}
  window.close();
</script>
</body></html>"#,
        msg = if ok { "Slack connected" } else { "Slack connection failed" },
    )
}

/// Escape a JSON string for safe embedding inside an inline `<script>`: neutralize
/// `<`, `>`, `&` (HTML/`</script>` breakout) and the JS line separators U+2028/U+2029.
fn escape_for_script(json: &str) -> String {
    json.replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

pub fn protected_router() -> Router<AppState> {
    Router::new()
        .route("/integrations/slack/connect", get(slack_connect))
        .route("/integrations/{id}/slack/channels", get(slack_channels))
}

pub fn public_router() -> Router<AppState> {
    Router::new().route("/integrations/slack/callback", get(slack_callback))
}

#[cfg(test)]
mod tests {
    use super::escape_for_script;

    #[test]
    fn escape_neutralizes_script_breakout() {
        // A reflected Slack ?error= containing </script> must not break out.
        let json = r#"{"error":"</script><img src=x onerror=alert(1)>"}"#;
        let escaped = escape_for_script(json);
        assert!(!escaped.contains("</script>"));
        assert!(!escaped.contains('<'));
        assert!(!escaped.contains('>'));
        assert!(escaped.contains("\\u003c"));
        assert!(escaped.contains("\\u003e"));
    }
}
