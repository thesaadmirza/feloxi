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

/// A failed channel delivery queued for retry. Serialized into the Redis ZSET
/// scored by next-attempt time.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct DeliveryRetryJob {
    pub tenant_id: Uuid,
    /// History row whose delivery log gets updated after the retry.
    pub history_id: Uuid,
    /// The attempt about to run (2-based: attempt 1 was the inline send).
    pub attempt: u32,
    pub channel: AlertChannel,
    pub alert: FiredAlert,
}

/// Queue a retry for a failed delivery, if the failure is transient and the
/// attempt budget allows. `attempt` is the attempt that just failed.
pub(crate) async fn maybe_schedule_retry(
    state: &AppState,
    tenant_id: Uuid,
    history_id: Uuid,
    attempt: u32,
    channel: &AlertChannel,
    alert: &FiredAlert,
    result: &SendResult,
) {
    if !alerting::recovery::is_retryable(result)
        || attempt >= alerting::recovery::MAX_DELIVERY_ATTEMPTS
    {
        return;
    }
    let job = DeliveryRetryJob {
        tenant_id,
        history_id,
        attempt: attempt + 1,
        channel: channel.clone(),
        alert: alert.clone(),
    };
    let json = match serde_json::to_string(&job) {
        Ok(j) => j,
        Err(e) => {
            tracing::warn!(error = %e, "failed to serialize delivery retry job");
            return;
        }
    };
    let at = common::time::to_unix_f64(&common::time::now())
        + alerting::recovery::backoff_secs(attempt, result.retry_after);
    if let Err(e) = db::redis::cache::schedule_delivery_retry(&state.redis, &json, at).await {
        tracing::warn!(error = ?e, "failed to queue delivery retry");
    }
}

/// How many due retries one drain pass processes.
const RETRY_DRAIN_BATCH: u64 = 50;

/// Drain due delivery retries: re-send, record the outcome on the history row,
/// and requeue transient failures until the attempt budget runs out.
pub(crate) async fn drain_delivery_retries(state: &AppState) {
    let now = common::time::to_unix_f64(&common::time::now());
    let due = match db::redis::cache::pop_due_delivery_retries(&state.redis, now, RETRY_DRAIN_BATCH)
        .await
    {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!(error = ?e, "failed to pop delivery retries");
            return;
        }
    };

    // One tenant+integrations load per tenant per pass, not per job.
    let mut tenant_cache: HashMap<Uuid, (Tenant, HashMap<Uuid, Integration>)> = HashMap::new();

    for raw in due {
        let job: DeliveryRetryJob = match serde_json::from_str(&raw) {
            Ok(j) => j,
            Err(e) => {
                tracing::warn!(error = %e, "dropping malformed delivery retry job");
                continue;
            }
        };

        let (tenant, integrations) = match tenant_cache.entry(job.tenant_id) {
            std::collections::hash_map::Entry::Occupied(e) => e.into_mut(),
            std::collections::hash_map::Entry::Vacant(e) => {
                let Ok(tenant) =
                    db::postgres::tenants::get_tenant_by_id(&state.pg, job.tenant_id).await
                else {
                    tracing::warn!(tenant_id = %job.tenant_id, "dropping retry for missing tenant");
                    continue;
                };
                let integrations =
                    db::postgres::integrations::map_integrations(&state.pg, job.tenant_id)
                        .await
                        .unwrap_or_default();
                e.insert((tenant, integrations))
            }
        };

        let result =
            deliver_channel(state, &state.http, tenant, integrations, &job.channel, &job.alert)
                .await;

        let status = db::postgres::models::ChannelDeliveryStatus {
            success: result.success,
            error: result.error.clone(),
        };
        if let Err(e) = db::postgres::alert_rules::update_delivery_status(
            &state.pg,
            job.tenant_id,
            job.history_id,
            &result.delivery_key(),
            &status,
        )
        .await
        {
            tracing::warn!(error = %e, history_id = %job.history_id, "failed to update delivery log");
        }

        if result.success {
            tracing::info!(
                history_id = %job.history_id,
                channel = %result.delivery_key(),
                attempt = job.attempt,
                "alert delivery retry succeeded"
            );
        } else {
            maybe_schedule_retry(
                state,
                job.tenant_id,
                job.history_id,
                job.attempt,
                &job.channel,
                &job.alert,
                &result,
            )
            .await;
        }
    }
}
