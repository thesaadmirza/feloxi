//! "Sign in with Google" (OIDC authorization-code flow).
//!
//! Both endpoints are PUBLIC — this is a login path, there is no session yet.
//! `connect` redirects to Google's consent screen with a signed `state` +
//! nonce cookie. `callback` verifies the state, exchanges the code, reads the
//! verified profile from the userinfo endpoint (over TLS from Google, so no
//! local JWT validation is needed), and — for an existing user with that
//! verified email — mints a one-time login token and hands the browser to the
//! existing magic-link page, which finishes the session (including the
//! multi-org picker). SSO is a sign-in method, not a signup path: unknown
//! emails are turned away so a stray Google account can't self-provision.

use axum::http::header::{HeaderMap, SET_COOKIE};
use axum::{
    extract::{Query, State},
    response::{IntoResponse, Redirect, Response},
    routing::get,
    Router,
};
use uuid::Uuid;

use crate::oauth::{self, err_chain};
use crate::routes::oauth_slack::CallbackParams;
use crate::state::AppState;
use common::AppError;

const GOOGLE_DOMAIN: &str = "feloxi-sso-google-v1";
const GOOGLE_SCOPES: &str = "openid email";
const CALLBACK_PATH: &str = "/auth/google/callback";
/// SSO handoff tokens are consumed by an immediate redirect, not an email —
/// keep them much shorter-lived than emailed magic links.
const SSO_TOKEN_TTL_MINUTES: i64 = 2;

fn authorize_url() -> &'static str {
    "https://accounts.google.com/o/oauth2/v2/auth"
}
fn token_url() -> &'static str {
    "https://oauth2.googleapis.com/token"
}
fn userinfo_url() -> &'static str {
    "https://openidconnect.googleapis.com/v1/userinfo"
}

/// GET /auth/google/connect — PUBLIC; redirects to Google's consent screen.
pub async fn google_connect(State(state): State<AppState>) -> Result<Response, AppError> {
    let client = state
        .config
        .oauth
        .google
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("Google SSO is not configured".into()))?;

    // No tenant yet (pre-auth); the state still carries the CSRF nonce and is
    // domain-bound so it can't be replayed against the integration flows.
    let (state_str, nonce) = oauth::build_state(&state.encryptor, GOOGLE_DOMAIN, Uuid::nil(), None);
    if let Err(e) = db::redis::cache::store_oauth_nonce(&state.redis, &nonce, 600).await {
        tracing::warn!(error = %e, "failed to store OAuth nonce (Redis unavailable)");
    }
    let redirect = oauth::redirect_uri(&state, CALLBACK_PATH);

    let url = reqwest::Url::parse_with_params(
        authorize_url(),
        &[
            ("client_id", client.client_id.as_str()),
            ("scope", GOOGLE_SCOPES),
            ("response_type", "code"),
            ("redirect_uri", redirect.as_str()),
            ("state", state_str.as_str()),
            ("prompt", "select_account"),
        ],
    )
    .map_err(|e| AppError::Internal(format!("failed to build Google authorize URL: {e}")))?;

    let mut headers = HeaderMap::new();
    headers.insert(
        SET_COOKIE,
        oauth::set_state_cookie(&state, &nonce).parse().expect("valid cookie header"),
    );
    Ok((headers, Redirect::to(url.as_str())).into_response())
}

/// GET /auth/google/callback — PUBLIC. On success redirects to the magic-link
/// page with a one-time login token; on failure back to /login with a message.
pub async fn google_callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<CallbackParams>,
) -> Response {
    let mut out_headers = HeaderMap::new();
    out_headers.insert(
        SET_COOKIE,
        oauth::clear_state_cookie(&state).parse().expect("valid cookie header"),
    );

    let app = state.config.app_base_url.trim_end_matches('/').to_string();
    let target = match google_callback_inner(&state, &headers, &params).await {
        Ok(token) => format!("{app}/auth/magic-link/{token}"),
        Err(msg) => reqwest::Url::parse_with_params(
            &format!("{app}/auth/login"),
            &[("sso_error", msg.as_str())],
        )
        .map(String::from)
        .unwrap_or_else(|_| format!("{app}/auth/login")),
    };
    (out_headers, Redirect::to(&target)).into_response()
}

async fn google_callback_inner(
    state: &AppState,
    headers: &HeaderMap,
    params: &CallbackParams,
) -> Result<String, String> {
    if let Some(err) = &params.error {
        return Err(format!("Google sign-in was declined ({err})"));
    }
    let code = params.code.as_deref().ok_or("missing authorization code")?;
    let state_str = params.state.as_deref().ok_or("missing state")?;

    let cookie_header = headers.get(axum::http::header::COOKIE).and_then(|v| v.to_str().ok());
    let nonce = oauth::cookie_value(cookie_header, oauth::STATE_COOKIE)
        .ok_or("missing state cookie — try signing in again")?;

    let verified = oauth::verify_state(&state.encryptor, GOOGLE_DOMAIN, state_str, nonce)
        .ok_or("invalid or expired state — try signing in again")?;

    match db::redis::cache::consume_oauth_nonce(&state.redis, &verified.nonce).await {
        Ok(true) => {}
        Ok(false) => return Err("sign-in link already used — try again".into()),
        Err(e) => {
            tracing::warn!(error = %e, "OAuth nonce check skipped (Redis unavailable)");
        }
    }

    let client = state.config.oauth.google.as_ref().ok_or("Google SSO not configured")?;
    let redirect = oauth::redirect_uri(state, CALLBACK_PATH);

    let resp = match state
        .http
        .post(token_url())
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", client.client_id.as_str()),
            ("client_secret", client.client_secret.as_str()),
            ("redirect_uri", redirect.as_str()),
        ])
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %err_chain(&e), "Google token exchange request failed");
            return Err("Google sign-in failed — try again".into());
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
        tracing::warn!(error = code, "Google rejected the token exchange");
        return Err("Google sign-in failed — try again".into());
    }
    let access_token =
        body.get("access_token").and_then(|v| v.as_str()).ok_or("no access token from Google")?;

    // The userinfo endpoint returns Google-asserted claims over TLS; no local
    // id_token signature validation is needed on this path.
    let userinfo: serde_json::Value =
        match state.http.get(userinfo_url()).bearer_auth(access_token).send().await {
            Ok(r) => r.json().await.map_err(|e| e.to_string())?,
            Err(e) => {
                tracing::warn!(error = %err_chain(&e), "Google userinfo request failed");
                return Err("Google sign-in failed — try again".into());
            }
        };

    let email = userinfo
        .get("email")
        .and_then(|v| v.as_str())
        .ok_or("Google account has no email")?
        .trim()
        .to_lowercase();
    let email_verified = userinfo
        .get("email_verified")
        .map(|v| v.as_bool().unwrap_or(v.as_str() == Some("true")))
        .unwrap_or(false);
    if !email_verified {
        return Err("your Google email address is not verified".into());
    }

    // Sign-in only: the email must already belong to a Feloxi user.
    let users = db::postgres::users::find_users_by_email(&state.pg, &email)
        .await
        .map_err(|e| e.to_string())?;
    if users.is_empty() {
        return Err(format!("no Feloxi account for {email} — ask an admin to invite you"));
    }

    // Hand off to the existing magic-link verification (it handles the
    // multi-org picker and session issuance).
    let token = auth::jwt::generate_refresh_token();
    let token_hash = auth::jwt::hash_refresh_token(&token);
    let expires_at = chrono::Utc::now() + chrono::Duration::minutes(SSO_TOKEN_TTL_MINUTES);
    db::postgres::magic_links::create_magic_link(&state.pg, &email, &token_hash, expires_at)
        .await
        .map_err(|e| e.to_string())?;

    Ok(token)
}

pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/auth/google/connect", get(google_connect))
        .route("/auth/google/callback", get(google_callback))
}
