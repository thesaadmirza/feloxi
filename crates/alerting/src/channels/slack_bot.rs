use reqwest::Client;
use serde_json::json;

use super::slack::{build_blocks, fallback_text, severity_color};
use super::SendResult;
use crate::engine::FiredAlert;

/// Send an alert via a Slack bot token using `chat.postMessage`.
///
/// Unlike incoming webhooks, the Web API returns HTTP 200 with
/// `{"ok":false,"error":"..."}` on logical failures, so success is determined
/// by the `ok` field, not the HTTP status. `channel_not_found`/`not_in_channel`
/// yield an actionable message; `account_inactive`/`invalid_auth` indicate the
/// install was revoked (see [`is_workspace_revoked`]).
pub async fn send_slack_bot_alert(
    client: &Client,
    api_base: &str,
    bot_token: &str,
    channel_id: &str,
    alert: &FiredAlert,
) -> SendResult {
    let payload = json!({
        "channel": channel_id,
        "text": fallback_text(alert),
        "attachments": [{
            "color": severity_color(alert),
            "blocks": build_blocks(alert),
        }]
    });

    let url = format!("{}/api/chat.postMessage", api_base.trim_end_matches('/'));
    let resp = match client.post(&url).bearer_auth(bot_token).json(&payload).send().await {
        Ok(r) => r,
        Err(e) => return SendResult::err("slack", e),
    };

    let status = resp.status().as_u16();
    let body: serde_json::Value = match resp.json().await {
        Ok(b) => b,
        Err(e) => {
            return SendResult::err("slack", format!("invalid Slack response: {e}"))
                .with_status(status)
        }
    };

    if body.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        return SendResult::ok("slack").with_status(status);
    }

    let code = body.get("error").and_then(|v| v.as_str()).unwrap_or("unknown_error");
    SendResult::err("slack", actionable_message(code)).with_status(status)
}

/// Whether a Slack error code means the whole install/token is dead (so the
/// integration should be marked `revoked`), as opposed to a per-channel issue.
pub fn is_workspace_revoked(error: &str) -> bool {
    error.contains("account_inactive")
        || error.contains("invalid_auth")
        || error.contains("token_revoked")
        || error.contains("token_expired")
}

fn actionable_message(code: &str) -> String {
    match code {
        // With chat:write.public the bot posts to public channels without
        // joining, so a public channel rarely errors here. `not_in_channel`
        // means a known channel the bot hasn't joined; `channel_not_found`
        // means the bot can't see it — most often a private channel it was
        // never invited to (or one renamed/archived).
        "not_in_channel" => {
            format!("{code}: invite the Feloxi bot to this channel (`/invite @Feloxi`), then retry.")
        }
        "channel_not_found" => format!(
            "{code}: can't see this channel — if it's private, invite the Feloxi bot (`/invite @Feloxi`) and Refresh; otherwise it may be archived or renamed."
        ),
        "account_inactive" | "invalid_auth" | "token_revoked" | "token_expired" => {
            format!("{code}: Slack connection is no longer valid — reconnect the workspace.")
        }
        other => other.to_string(),
    }
}
