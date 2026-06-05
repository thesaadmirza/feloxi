//! Channel delivery: routes a fired alert to each configured channel,
//! resolving + decrypting connected integrations and marking them revoked on a
//! dead token/webhook. Shared by the eval loop and the per-integration test
//! endpoint.

use std::collections::HashMap;

use uuid::Uuid;

use alerting::channels::{self, SendResult};
use alerting::engine::FiredAlert;
use alerting::rules::AlertChannel;
use common::crypto::Secret;
use db::postgres::models::{Integration, Tenant};

use crate::smtp::tenant_smtp_config;
use crate::state::AppState;

/// Deliver one alert to one channel. For `*_connection` channels, resolves and
/// decrypts the referenced integration (lazily, only here), routes to the right
/// sender, and marks the integration `revoked` on a dead token/webhook. The
/// returned [`SendResult`] is tagged with the integration id so the delivery
/// log keys per-integration.
pub(crate) async fn deliver_channel(
    state: &AppState,
    http_client: &reqwest::Client,
    tenant: &Tenant,
    integrations: &HashMap<Uuid, Integration>,
    channel: &AlertChannel,
    alert: &FiredAlert,
) -> SendResult {
    match channel {
        // ── Legacy inline channels (plaintext secrets, kept for back-compat) ──
        AlertChannel::Slack { webhook_url } => {
            channels::slack::send_slack_alert(http_client, webhook_url, alert).await
        }
        AlertChannel::Webhook { url, headers } => {
            channels::webhook::send_webhook_alert(http_client, url, headers, alert).await
        }
        AlertChannel::PagerDuty { routing_key } => {
            channels::pagerduty::send_pagerduty_alert(http_client, routing_key, alert).await
        }
        AlertChannel::Email { to } => {
            let smtp_cfg = tenant_smtp_config(tenant);
            channels::email::send_email_alert(to, alert, &smtp_cfg).await
        }

        // ── Connected (encrypted) integrations ──
        AlertChannel::SlackConnection { integration_id, channel_id, .. } => {
            let token =
                match decrypt_integration_secret(state, integrations, *integration_id, "slack") {
                    Ok(t) => t,
                    Err(e) => return e,
                };
            let result = channels::slack_bot::send_slack_bot_alert(
                http_client,
                &state.config.slack_api_base,
                token.expose(),
                channel_id,
                alert,
            )
            .await;
            if let Some(err) = result.error.as_deref() {
                if channels::slack_bot::is_workspace_revoked(err) {
                    mark_integration_revoked(state, tenant.id, *integration_id).await;
                }
            }
            result.with_integration_id(*integration_id)
        }
        AlertChannel::DiscordConnection { integration_id } => {
            let url =
                match decrypt_integration_secret(state, integrations, *integration_id, "discord") {
                    Ok(u) => u,
                    Err(e) => return e,
                };
            let result =
                channels::discord::send_discord_alert(http_client, url.expose(), alert).await;
            if channels::discord::is_webhook_revoked(&result) {
                mark_integration_revoked(state, tenant.id, *integration_id).await;
            }
            result.with_integration_id(*integration_id)
        }
        AlertChannel::PagerDutyConnection { integration_id } => {
            let key =
                match decrypt_integration_secret(state, integrations, *integration_id, "pagerduty")
                {
                    Ok(k) => k,
                    Err(e) => return e,
                };
            channels::pagerduty::send_pagerduty_alert(http_client, key.expose(), alert)
                .await
                .with_integration_id(*integration_id)
        }
        AlertChannel::WebhookConnection { integration_id } => {
            let url =
                match decrypt_integration_secret(state, integrations, *integration_id, "webhook") {
                    Ok(u) => u,
                    Err(e) => return e,
                };
            let headers = integrations.get(integration_id).and_then(|i| {
                i.config
                    .0
                    .get("headers")
                    .and_then(|h| serde_json::from_value::<HashMap<String, String>>(h.clone()).ok())
            });
            channels::webhook::send_webhook_alert(http_client, url.expose(), &headers, alert)
                .await
                .with_integration_id(*integration_id)
        }
    }
}

/// Look up an integration in the per-tenant map and decrypt its secret. On any
/// failure returns an `Err(SendResult)` already tagged with the integration id,
/// ready to record in the delivery log.
pub(crate) fn decrypt_integration_secret(
    state: &AppState,
    integrations: &HashMap<Uuid, Integration>,
    id: Uuid,
    channel_type: &str,
) -> Result<Secret, SendResult> {
    let err = |msg: String| Err(SendResult::err(channel_type, msg).with_integration_id(id));

    let Some(integration) = integrations.get(&id) else {
        return err("integration not found".into());
    };
    if integration.status != "active" {
        return err(format!("integration is {}", integration.status));
    }
    let Some(blob) = integration.secret_enc.as_deref() else {
        return err("integration has no stored secret".into());
    };
    match state.encryptor.decrypt_str(blob) {
        Ok(secret) => Ok(Secret::new(secret)),
        Err(e) => err(format!("secret decrypt failed: {e}")),
    }
}

pub(crate) async fn mark_integration_revoked(state: &AppState, tenant_id: Uuid, id: Uuid) {
    if let Err(e) =
        db::postgres::integrations::set_integration_status(&state.pg, tenant_id, id, "revoked")
            .await
    {
        tracing::warn!(error = %e, integration_id = %id, "failed to mark integration revoked");
    }
    // A revoked token can't list channels — drop the stale cache.
    let _ = db::redis::cache::clear_slack_channels(&state.redis, id).await;
}
