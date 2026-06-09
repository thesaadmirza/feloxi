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
    // Best-effort: if Redis is down the callback falls back to the HMAC+cookie
    // check, so a store failure shouldn't block connecting.
    if let Err(e) = db::redis::cache::store_oauth_nonce(&state.redis, &nonce, 600).await {
        tracing::warn!(error = %e, "failed to store OAuth nonce (Redis unavailable)");
    }
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
    // even within the signature TTL. If Redis is unreachable, fall open rather
    // than hard-fail the flow — CSRF is still covered by the HMAC-signed state +
    // cookie nonce, and the Slack authorization `code` is itself single-use
    // (a replayed callback re-exchanges the same code → Slack returns
    // invalid_code), so replay is bounded even without the Redis check.
    match db::redis::cache::consume_oauth_nonce(&state.redis, &verified.nonce).await {
        Ok(true) => {}
        Ok(false) => return Err("state already used or expired".into()),
        Err(e) => {
            tracing::warn!(error = %e, "OAuth nonce check skipped (Redis unavailable)");
        }
    }

    let client = state.config.oauth.slack.as_ref().ok_or("Slack OAuth not configured")?;
    let redirect = oauth::redirect_uri(state, CALLBACK_PATH);

    let resp = match state
        .http
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

    // Reconnect may grant access to different channels — drop any stale cache.
    let _ = db::redis::cache::clear_slack_channels(&state.redis, integration.id).await;

    Ok(integration.id)
}

#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct SlackChannel {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, ToSchema)]
pub struct SlackChannelsResponse {
    pub data: Vec<SlackChannel>,
    /// Total channels matching the query (before the `limit` slice).
    pub total: usize,
    /// True if more matches exist than were returned — narrow the search.
    pub truncated: bool,
}

#[derive(Deserialize)]
pub struct ChannelsQuery {
    /// Case-insensitive name filter. Empty returns the first page.
    #[serde(default)]
    pub q: Option<String>,
    /// Max results to return (default 50, capped at 100).
    #[serde(default)]
    pub limit: Option<usize>,
    /// Bypass the server cache and re-enumerate from Slack (e.g. after inviting
    /// the bot to a private channel).
    #[serde(default)]
    pub refresh: Option<bool>,
}

/// GET /integrations/{id}/slack/channels — authenticated; live name search over
/// a server-cached channel list (so workspaces with thousands of channels don't
/// ship the whole list to the client). Slack has no channel-search API, so the
/// full list is enumerated once and cached in Redis (5-min TTL); `?q=` filters
/// it server-side and returns at most `limit` matches.
#[utoipa::path(
    get,
    path = "/api/v1/integrations/{id}/slack/channels",
    tag = "integrations",
    params(
        ("id" = Uuid, Path, description = "Slack integration ID"),
        ("q" = Option<String>, Query, description = "Case-insensitive name filter"),
        ("limit" = Option<usize>, Query, description = "Max results (default 50, max 100)"),
        ("refresh" = Option<bool>, Query, description = "Bypass cache and re-enumerate")
    ),
    responses((status = 200, description = "Success", body = SlackChannelsResponse))
)]
pub async fn slack_channels(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<Uuid>,
    Query(params): Query<ChannelsQuery>,
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

    // Pull the full list from cache, or enumerate from Slack and cache it.
    let cache_key = db::redis::cache::slack_channels_key(id);
    let mut all: Vec<SlackChannel> = if params.refresh.unwrap_or(false) {
        Vec::new()
    } else {
        db::redis::cache::get_json(&state.redis, &cache_key)
            .await
            .ok()
            .flatten()
            .unwrap_or_default()
    };
    if all.is_empty() {
        all = load_channels_single_flight(&state, id, &cache_key, &token).await?;
    }

    // Filter + slice server-side; the client only ever sees a small page.
    let q = params.q.unwrap_or_default();
    let limit = params.limit.unwrap_or(50).clamp(1, 100);
    let (data, total, truncated) = filter_channels(all, &q, limit);
    Ok(Json(SlackChannelsResponse { data, total, truncated }))
}

/// Case-insensitive name filter + sort + truncate. Returns `(page, total,
/// truncated)` where `total` is the full match count before the `limit` slice.
fn filter_channels(
    all: Vec<SlackChannel>,
    q: &str,
    limit: usize,
) -> (Vec<SlackChannel>, usize, bool) {
    let needle = q.trim().to_lowercase();
    let mut matches: Vec<SlackChannel> = if needle.is_empty() {
        all
    } else {
        all.into_iter().filter(|c| c.name.to_lowercase().contains(&needle)).collect()
    };
    // Case-insensitive sort so e.g. "Zebra" doesn't jump above "alerts".
    matches.sort_by_key(|c| c.name.to_lowercase());
    let total = matches.len();
    let truncated = total > limit;
    matches.truncate(limit);
    (matches, total, truncated)
}

/// Populate the channel list under a single-flight lock so a burst of searches
/// (fast keystrokes, multiple editors) doesn't each enumerate Slack and trip the
/// Tier-2 `conversations.list` rate limit. The lock holder enumerates and caches;
/// everyone else waits briefly for the cache to appear, then gives up with 429.
async fn load_channels_single_flight(
    state: &AppState,
    id: Uuid,
    cache_key: &str,
    token: &str,
) -> Result<Vec<SlackChannel>, AppError> {
    use db::redis::cache;
    // If Redis is unavailable, default to enumerating ourselves (don't deadlock).
    let acquired = cache::try_lock_slack_channels(&state.redis, id, 30).await.unwrap_or(true);
    if !acquired {
        // Another request is enumerating — wait briefly for it to fill the cache.
        for _ in 0..6 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if let Ok(Some(list)) =
                cache::get_json::<Vec<SlackChannel>>(&state.redis, cache_key).await
            {
                if !list.is_empty() {
                    return Ok(list);
                }
            }
        }
        return Err(AppError::RateLimited);
    }

    let result = fetch_all_slack_channels(state, token).await;
    if let Ok(ref list) = result {
        let _ = cache::set_json(&state.redis, cache_key, list, std::time::Duration::from_secs(300))
            .await;
    }
    let _ = cache::unlock_slack_channels(&state.redis, id).await;
    result
}

/// Enumerate every channel the bot can see (public + member private), paginated.
/// `conversations.list` is Tier 2 (~20 req/min); on a 429 we honor `Retry-After`
/// and retry the same page within a bounded budget, returning `RateLimited` (429,
/// retryable) rather than a 500 if the budget is exhausted.
async fn fetch_all_slack_channels(
    state: &AppState,
    token: &str,
) -> Result<Vec<SlackChannel>, AppError> {
    let mut channels = Vec::new();
    let mut cursor = String::new();
    // Total time we're willing to spend backing off; bounded so the request
    // can't hang. If exhausted we surface 429 and the client retries later.
    let mut backoff_budget = std::time::Duration::from_secs(15);
    // Cap pages to bound very large (Enterprise Grid) workspaces.
    for _ in 0..50 {
        let body: serde_json::Value = loop {
            let mut req = state.http.get(conversations_url(state)).bearer_auth(token).query(&[
                ("types", "public_channel,private_channel"),
                ("exclude_archived", "true"),
                ("limit", "200"),
            ]);
            if !cursor.is_empty() {
                req = req.query(&[("cursor", cursor.as_str())]);
            }
            let resp = req
                .send()
                .await
                .map_err(|e| AppError::Internal(format!("Slack API error: {}", e.without_url())))?;

            // HTTP 429: back off for Retry-After (capped) and retry this page.
            if resp.status().as_u16() == 429 {
                let wait = retry_after(&resp).min(std::time::Duration::from_secs(5));
                if wait > backoff_budget {
                    return Err(AppError::RateLimited);
                }
                backoff_budget -= wait;
                tokio::time::sleep(wait).await;
                continue;
            }

            let body: serde_json::Value =
                resp.json().await.map_err(|e| AppError::Internal(e.to_string()))?;

            if !body.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                let code = body.get("error").and_then(|v| v.as_str()).unwrap_or("unknown_error");
                // Slack sometimes returns HTTP 200 with `ok:false, error:ratelimited`.
                if code == "ratelimited" {
                    let wait = std::time::Duration::from_secs(1);
                    if wait > backoff_budget {
                        return Err(AppError::RateLimited);
                    }
                    backoff_budget -= wait;
                    tokio::time::sleep(wait).await;
                    continue;
                }
                return Err(AppError::Internal(format!("Slack conversations.list failed: {code}")));
            }
            break body;
        };

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
    Ok(channels)
}

/// Parse the `Retry-After` header (whole seconds) from a 429, defaulting to 1s.
fn retry_after(resp: &reqwest::Response) -> std::time::Duration {
    let secs = resp
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(1);
    std::time::Duration::from_secs(secs)
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
    use super::{escape_for_script, filter_channels, SlackChannel};

    fn chans(names: &[&str]) -> Vec<SlackChannel> {
        names.iter().map(|n| SlackChannel { id: format!("C-{n}"), name: n.to_string() }).collect()
    }

    #[test]
    fn filter_channels_searches_sorts_and_truncates() {
        let all = chans(&["zebra", "alerts", "alpha", "team-alerts", "ops"]);

        // Empty query → all, sorted, no truncation when under limit.
        let (page, total, truncated) = filter_channels(all.clone(), "", 50);
        assert_eq!(total, 5);
        assert!(!truncated);
        assert_eq!(
            page.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            ["alerts", "alpha", "ops", "team-alerts", "zebra"]
        );

        // Case-insensitive substring match.
        let (page, total, _) = filter_channels(all.clone(), "ALERT", 50);
        assert_eq!(total, 2);
        assert_eq!(
            page.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            ["alerts", "team-alerts"]
        );

        // Truncation: total reflects pre-slice count, page is capped.
        let (page, total, truncated) = filter_channels(all, "", 2);
        assert_eq!(total, 5);
        assert!(truncated);
        assert_eq!(page.len(), 2);
        assert_eq!(page[0].name, "alerts");

        // No match.
        let (page, total, truncated) = filter_channels(chans(&["a", "b"]), "zzz", 50);
        assert!(page.is_empty());
        assert_eq!(total, 0);
        assert!(!truncated);

        // Case-insensitive sort: "Zebra" should not jump above "alerts".
        let (page, _, _) = filter_channels(chans(&["Zebra", "alerts", "Ops"]), "", 50);
        assert_eq!(
            page.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            ["alerts", "Ops", "Zebra"]
        );
    }

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
