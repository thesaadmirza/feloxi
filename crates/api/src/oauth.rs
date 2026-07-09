//! Shared OAuth helpers: signed, expiring `state` + a single-use `oauth_state`
//! cookie for CSRF protection on connect/callback flows.
//!
//! The callback runs on the PUBLIC router (the browser arrives via a top-level
//! redirect from the provider with no session), so tenant identity travels in
//! the HMAC-signed `state` and is bound to a nonce echoed in the cookie. Not a
//! `__Host-` cookie — that requires `Secure`, which breaks the documented
//! `http://localhost` dev setup.

use base64::Engine;
use common::crypto::Encryptor;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::state::AppState;

pub const STATE_COOKIE: &str = "fp_oauth_state";
const STATE_TTL_SECS: i64 = 600;

/// Signed payload carried in the OAuth `state` query parameter.
#[derive(Serialize, Deserialize)]
pub struct OAuthState {
    /// Tenant that initiated the flow (from the authenticated connect request).
    pub tid: Uuid,
    /// Random nonce, also echoed in the `fp_oauth_state` cookie (CSRF binding).
    pub nonce: String,
    /// Optional user-supplied integration name (Discord has no channel names).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Expiry, unix seconds.
    pub exp: i64,
}

/// Build a signed `state` string (`base64url(json).sig`) plus the nonce to set
/// in the cookie. `domain` separates providers (e.g. `"feloxi-oauth-slack-v1"`).
pub fn build_state(
    enc: &Encryptor,
    domain: &str,
    tenant_id: Uuid,
    name: Option<String>,
) -> (String, String) {
    let nonce = Uuid::new_v4().to_string();
    let payload = OAuthState {
        tid: tenant_id,
        nonce: nonce.clone(),
        name,
        exp: chrono::Utc::now().timestamp() + STATE_TTL_SECS,
    };
    let json = serde_json::to_vec(&payload).expect("serialize oauth state");
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&json);
    let sig = enc.sign(domain, b64.as_bytes());
    (format!("{b64}.{sig}"), nonce)
}

/// Verify a `state` string: HMAC signature, expiry, and nonce/cookie match.
pub fn verify_state(
    enc: &Encryptor,
    domain: &str,
    raw: &str,
    cookie_nonce: &str,
) -> Option<OAuthState> {
    let (b64, sig) = raw.split_once('.')?;
    if !enc.verify(domain, b64.as_bytes(), sig) {
        return None;
    }
    let json = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(b64).ok()?;
    let payload: OAuthState = serde_json::from_slice(&json).ok()?;
    if payload.exp < chrono::Utc::now().timestamp() {
        return None;
    }
    if payload.nonce != cookie_nonce {
        return None;
    }
    Some(payload)
}

fn is_secure(state: &AppState) -> bool {
    // The OAuth state cookie is set/read on the app origin (the callback runs on
    // app_base_url), so derive Secure from that, not the CORS allowlist.
    state.config.app_base_url.starts_with("https://")
}

/// `Set-Cookie` value that stores the state nonce (single-use, 10-min TTL).
pub fn set_state_cookie(state: &AppState, nonce: &str) -> String {
    let secure = if is_secure(state) { "; Secure" } else { "" };
    format!(
        "{STATE_COOKIE}={nonce}; HttpOnly; Path=/api/v1; Max-Age={STATE_TTL_SECS}; SameSite=Lax{secure}"
    )
}

/// `Set-Cookie` value that clears the state cookie (consume on callback).
pub fn clear_state_cookie(state: &AppState) -> String {
    let secure = if is_secure(state) { "; Secure" } else { "" };
    format!("{STATE_COOKIE}=; HttpOnly; Path=/api/v1; Max-Age=0; SameSite=Lax{secure}")
}

/// Extract a cookie value from a raw `Cookie` header.
pub fn cookie_value<'a>(cookie_header: Option<&'a str>, name: &str) -> Option<&'a str> {
    cookie_header?.split(';').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k.trim() == name).then_some(v.trim())
    })
}

/// The OAuth redirect URI for a provider callback, built from `APP_BASE_URL`
/// (the web origin; `/api/*` is proxied to this API). Must match the value
/// registered in the provider console exactly.
pub fn redirect_uri(state: &AppState, path: &str) -> String {
    format!("{}/api/v1{}", state.config.app_base_url.trim_end_matches('/'), path)
}

/// Flatten an error's full `source` chain into one string for logging.
pub fn err_chain(e: &dyn std::error::Error) -> String {
    let mut parts = vec![e.to_string()];
    let mut src = e.source();
    while let Some(s) = src {
        parts.push(s.to_string());
        src = s.source();
    }
    parts.join(" -> ")
}

/// Render a tiny HTML page that posts the connect result to the opener and
/// closes. `provider` is the display name ("Slack"); `message_type` is the
/// postMessage discriminator the settings page listens for ("slack-oauth").
pub fn popup_page(
    state: &AppState,
    provider: &str,
    message_type: &str,
    ok: bool,
    integration_id: Option<Uuid>,
    error: Option<&str>,
) -> String {
    let origin = state.config.app_base_url.trim_end_matches('/');
    // The `error` string can contain attacker-controlled content (the public
    // callback reflects the provider's `?error=` param). Serialize to JSON, then
    // escape the sequences that could break out of the inline <script> / HTML
    // context.
    let payload = escape_for_script(
        &serde_json::json!({
            "type": message_type,
            "ok": ok,
            "integrationId": integration_id,
            "error": error,
        })
        .to_string(),
    );
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><title>{provider}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"></head>
<body style="font-family:system-ui;padding:2rem">
<p>{msg}. You can close this window.</p>
<script>
  try {{ if (window.opener) window.opener.postMessage({payload}, {origin:?}); }} catch (e) {{}}
  window.close();
</script>
</body></html>"#,
        msg = if ok {
            format!("{provider} connected")
        } else {
            format!("{provider} connection failed")
        },
    )
}

/// Escape a JSON string for safe embedding inside an inline `<script>`: neutralize
/// `<`, `>`, `&` (HTML/`</script>` breakout) and the JS line separators U+2028/U+2029.
pub fn escape_for_script(json: &str) -> String {
    json.replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enc() -> Encryptor {
        Encryptor::from_base64(&base64::engine::general_purpose::STANDARD.encode([7u8; 32]))
            .unwrap()
    }

    #[test]
    fn state_round_trips_and_binds_nonce_tenant() {
        let e = enc();
        let tid = Uuid::new_v4();
        let (state_str, nonce) = build_state(&e, "feloxi-oauth-slack-v1", tid, None);
        let verified = verify_state(&e, "feloxi-oauth-slack-v1", &state_str, &nonce).unwrap();
        assert_eq!(verified.tid, tid);
        assert_eq!(verified.nonce, nonce);
    }

    #[test]
    fn state_rejects_wrong_nonce_domain_and_tamper() {
        let e = enc();
        let (state_str, nonce) = build_state(&e, "feloxi-oauth-slack-v1", Uuid::new_v4(), None);

        // Wrong cookie nonce → reject (CSRF binding).
        assert!(verify_state(&e, "feloxi-oauth-slack-v1", &state_str, "other").is_none());
        // Wrong domain (cross-provider replay) → reject.
        assert!(verify_state(&e, "feloxi-oauth-discord-v1", &state_str, &nonce).is_none());
        // Tampered signature → reject.
        let tampered = format!("{state_str}x");
        assert!(verify_state(&e, "feloxi-oauth-slack-v1", &tampered, &nonce).is_none());
        // Different key → reject.
        let other =
            Encryptor::from_base64(&base64::engine::general_purpose::STANDARD.encode([9u8; 32]))
                .unwrap();
        assert!(verify_state(&other, "feloxi-oauth-slack-v1", &state_str, &nonce).is_none());
    }

    #[test]
    fn cookie_value_parses_target_key() {
        let header = "a=1; fp_oauth_state=abc123; b=2";
        assert_eq!(cookie_value(Some(header), STATE_COOKIE), Some("abc123"));
        assert_eq!(cookie_value(Some("x=1"), STATE_COOKIE), None);
        assert_eq!(cookie_value(None, STATE_COOKIE), None);
    }
}
