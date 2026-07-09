use std::sync::Arc;

use anyhow::Result;
use tokio::sync::broadcast;
use tracing_subscriber::{fmt, EnvFilter};
use uuid::Uuid;

mod alert_context;
mod alert_dispatch;
mod app;
mod broker_conn;
mod oauth;
mod openapi;
mod routes;
mod smtp;
mod state;
mod ws;

use state::{AppConfig, AppState, HealthCache, TenantEvent};

#[tokio::main]
async fn main() -> Result<()> {
    // Load .env if present
    let _ = dotenvy::dotenv();

    // Initialize tracing
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("api=debug,tower_http=debug")),
        )
        .json()
        .init();

    tracing::info!("Starting Feloxi API server");

    // Load configuration
    let config = AppConfig::from_env()?;
    let encryptor = Arc::new(state::load_encryptor()?);

    let pg = db::postgres::create_pg_pool(&config.database_url).await?;
    db::postgres::run_migrations(&pg)
        .await
        .map_err(|e| anyhow::anyhow!("PostgreSQL migration failed: {e}"))?;
    tracing::info!("PostgreSQL connected, migrations applied");

    let ch = db::clickhouse::create_ch_client_with_auth(
        &config.clickhouse_url,
        config.clickhouse_user.as_deref(),
        config.clickhouse_password.as_deref(),
    );
    db::clickhouse::schema::run_schema_init(
        &config.clickhouse_url,
        config.clickhouse_user.as_deref(),
        config.clickhouse_password.as_deref(),
    )
    .await
    .map_err(|e| anyhow::anyhow!("{e}"))?;
    tracing::info!("ClickHouse connected, schema initialized");

    let redis = db::redis::create_redis_pool(&config.redis_url).await?;
    tracing::info!("Redis connected");

    // Event broadcast channel — sized for high-throughput deployments (50K+ workers).
    // Slow WebSocket clients will lag and recover; this prevents producer blocking.
    let (event_tx, _) = broadcast::channel::<TenantEvent>(100_000);

    // Build app state
    let broker_manager = Arc::new(broker_conn::manager::BrokerConnectionManager::new());

    // One shared HTTP client (internally Arc'd): reused for OAuth token
    // exchange, the Slack channel listing, integration tests, and the alert
    // delivery loop so the connection pool and TLS sessions are shared.
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("Failed to build HTTP client");

    let state = AppState {
        pg,
        ch,
        redis,
        event_tx,
        broker_manager,
        config: Arc::new(config.clone()),
        jwt_keys: Arc::new(auth::jwt::JwtKeys::new(config.jwt_secret.as_bytes())),
        health_cache: Arc::new(HealthCache::new(std::time::Duration::from_secs(5))),
        encryptor,
        http,
    };

    // Auto-start active broker connections
    state.broker_manager.auto_start_active(&state).await;

    // Build router
    let app = app::create_router(state.clone());

    // Start background tasks
    spawn_background_tasks(state.clone());

    // Start server
    let addr = format!("0.0.0.0:{}", config.port);
    tracing::info!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).with_graceful_shutdown(shutdown_signal()).await?;

    tracing::info!("Server shut down gracefully");
    Ok(())
}

fn spawn_background_tasks(state: AppState) {
    // Alert evaluation engine (every 60s).
    let s = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        let mut throttle = alerting::throttle::AlertThrottle::new();
        let mut resolver = alerting::recovery::ResolveTracker::new();

        loop {
            interval.tick().await;
            if let Err(e) = run_alert_evaluation(&s, &mut throttle, &mut resolver).await {
                tracing::warn!(error = %e, "Alert evaluation cycle failed");
            }
        }
    });

    // Alert delivery retries (every 30s): re-send transient channel failures.
    let s = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        interval.tick().await; // skip immediate first tick
        loop {
            interval.tick().await;
            alert_dispatch::drain_delivery_retries(&s).await;
        }
    });

    // Data retention enforcer (every 1 hour).
    let s = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            interval.tick().await;
            if let Err(e) = enforce_retention(&s).await {
                tracing::warn!(error = %e, "Retention enforcement failed");
            }
        }
    });

    let s = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(10));
        interval.tick().await; // interval fires immediately on the first tick; skip it
        loop {
            interval.tick().await;
            tokio::join!(
                drain_retry_queue::<db::clickhouse::task_events::TaskEventRow>(&s),
                drain_retry_queue::<db::clickhouse::worker_events::WorkerEventRow>(&s),
            );
        }
    });

    // Queue depth pollster (every 30s). Polls every active broker for live
    // queue depths and writes them to Redis so the dashboard /live endpoint
    // can read them in sub-millisecond time without hammering brokers per
    // request.
    let s = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        interval.tick().await; // skip immediate first tick
        loop {
            interval.tick().await;
            poll_queue_depths(&s).await;
        }
    });
}

async fn poll_queue_depths(state: &AppState) {
    let configs = match db::postgres::broker_configs::list_active_broker_configs(&state.pg).await {
        Ok(cfgs) => cfgs,
        Err(e) => {
            tracing::warn!(error = %e, "Failed to list active brokers for queue poll");
            return;
        }
    };
    for config in configs {
        let queues =
            match broker_conn::commands::queue_stats(&config.broker_type, &config.connection_enc)
                .await
            {
                Ok(q) => q,
                Err(e) => {
                    tracing::debug!(
                        broker_id = %config.id,
                        tenant_id = %config.tenant_id,
                        error = %e,
                        "queue_stats poll failed",
                    );
                    continue;
                }
            };
        for q in queues {
            if let Err(e) = db::redis::cache::set_queue_depth(
                &state.redis,
                config.tenant_id,
                &q.queue_name,
                q.depth,
            )
            .await
            {
                tracing::debug!(
                    queue = %q.queue_name,
                    error = ?e,
                    "Failed to write queue depth cache",
                );
            }
        }
    }
}

/// Max batches drained per queue per tick. Bounds the peak row count flattened
/// into one ClickHouse insert (roughly this × typical batch size), keeping the
/// transient memory spike during replay well under 100 MB.
const RETRY_DRAIN_PER_CYCLE: usize = 100;

trait RetryRow: serde::de::DeserializeOwned + Send + Sync + 'static {
    const KIND: &'static str;
    fn insert_batch(
        ch: &clickhouse::Client,
        rows: &[Self],
    ) -> impl std::future::Future<Output = Result<(), common::AppError>> + Send;
}

impl RetryRow for db::clickhouse::task_events::TaskEventRow {
    const KIND: &'static str = db::redis::keys::RETRY_KIND_TASK;
    async fn insert_batch(ch: &clickhouse::Client, rows: &[Self]) -> Result<(), common::AppError> {
        db::clickhouse::task_events::insert_task_events(ch, rows).await
    }
}

impl RetryRow for db::clickhouse::worker_events::WorkerEventRow {
    const KIND: &'static str = db::redis::keys::RETRY_KIND_WORKER;
    async fn insert_batch(ch: &clickhouse::Client, rows: &[Self]) -> Result<(), common::AppError> {
        db::clickhouse::worker_events::insert_worker_events(ch, rows).await
    }
}

async fn drain_retry_queue<T: RetryRow>(state: &AppState) {
    let jsons =
        match db::redis::cache::pop_retry_batches(&state.redis, T::KIND, RETRY_DRAIN_PER_CYCLE)
            .await
        {
            Ok(v) if v.is_empty() => return,
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(kind = T::KIND, error = ?e, "Failed to pop retry queue");
                return;
            }
        };

    let mut good_jsons: Vec<String> = Vec::with_capacity(jsons.len());
    let mut all_rows: Vec<T> = Vec::new();
    for json in jsons {
        match serde_json::from_str::<Vec<T>>(&json) {
            Ok(mut rows) => {
                all_rows.append(&mut rows);
                good_jsons.push(json);
            }
            Err(e) => {
                // Re-parse as untyped to recover row count for drop metrics.
                let dropped = serde_json::from_str::<Vec<serde_json::Value>>(&json)
                    .map(|v| v.len() as u64)
                    .unwrap_or(1);
                let _ = db::redis::cache::incr_pipeline_counter(
                    &state.redis,
                    "events_dropped",
                    dropped,
                )
                .await;
                tracing::error!(
                    kind = T::KIND,
                    dropped,
                    error = ?e,
                    "Failed to deserialize buffered batch; discarding"
                );
            }
        }
    }

    if all_rows.is_empty() {
        return;
    }
    let count = all_rows.len() as u64;

    match T::insert_batch(&state.ch, &all_rows).await {
        Ok(_) => {
            let _ = db::redis::cache::incr_pipeline_counter(&state.redis, "events_inserted", count)
                .await;
            tracing::info!(count, kind = T::KIND, "Replayed buffered batches");
        }
        Err(e) => {
            let _ =
                db::redis::cache::requeue_retry_batches(&state.redis, T::KIND, good_jsons).await;
            tracing::debug!(
                count,
                kind = T::KIND,
                error = ?e,
                "Batch replay still failing; requeued"
            );
        }
    }
}

async fn run_alert_evaluation(
    state: &AppState,
    throttle: &mut alerting::throttle::AlertThrottle,
    resolver: &mut alerting::recovery::ResolveTracker,
) -> Result<(), String> {
    use alerting::{
        engine::{determine_severity, evaluate_condition, generate_summary, FiredAlert},
        rules::ResolvedAlertRule,
    };
    use db::postgres::models::ChannelDeliveryStatus;

    // Get all tenants
    let tenants =
        db::postgres::tenants::list_tenants(&state.pg, 1000, 0).await.map_err(|e| e.to_string())?;

    for tenant in &tenants {
        let tid = tenant.id;

        // Load enabled rules
        let db_rules = db::postgres::alert_rules::list_enabled_alert_rules(&state.pg, tid)
            .await
            .unwrap_or_default();

        // Open incidents by rule: drives fire dedup and the resolve half of
        // the state machine.
        let open_alerts: std::collections::HashMap<Uuid, chrono::DateTime<chrono::Utc>> =
            db::postgres::alert_rules::list_open_alerts(&state.pg, tid)
                .await
                .unwrap_or_default()
                .into_iter()
                .map(|o| (o.rule_id, o.first_fired_at))
                .collect();

        if db_rules.is_empty() && open_alerts.is_empty() {
            continue;
        }

        // Close incidents whose rule was deleted or disabled — silently, since
        // the rule (and its channels) may be gone.
        let enabled_ids: std::collections::HashSet<Uuid> = db_rules.iter().map(|r| r.id).collect();
        for rule_id in open_alerts.keys() {
            if !enabled_ids.contains(rule_id) {
                let _ =
                    db::postgres::alert_rules::resolve_alerts_for_rule(&state.pg, tid, *rule_id)
                        .await;
                resolver.forget(*rule_id);
            }
        }

        // Metrics are fetched lazily per rule (each condition reads different
        // stores, scoped to its own window/pattern/percentile) and memoized
        // across the tenant's rules for this pass.
        let mut ctx_builder = alert_context::AlertContextBuilder::new(state, tid);

        // Load this tenant's integrations once (secrets decrypted lazily, only
        // when a referencing channel actually fires).
        let integrations =
            db::postgres::integrations::map_integrations(&state.pg, tid).await.unwrap_or_default();

        // Active maintenance windows. Silenced rules still open and resolve
        // incidents (history stays truthful); only notifications are held.
        let silences =
            db::postgres::silences::list_active_silences(&state.pg, tid).await.unwrap_or_default();
        let is_silenced = |rule_id: Uuid| {
            silences.iter().any(|s| s.rule_id.is_none() || s.rule_id == Some(rule_id))
        };

        for db_rule in &db_rules {
            // condition and channels are already concrete types (via sqlx::types::Json<T>)
            let condition = &db_rule.condition.0;
            let channels = &db_rule.channels.0;

            let ctx = ctx_builder.context_for(condition).await;
            let fired = evaluate_condition(condition, &ctx);
            let open_since = open_alerts.get(&db_rule.id).copied();
            let silenced = is_silenced(db_rule.id);

            match (fired, open_since) {
                // Still firing: already notified when the incident opened.
                (true, Some(_)) => {
                    resolver.record_firing(db_rule.id);
                }

                // New incident — unless we're inside the flap cooldown.
                (true, None) => {
                    resolver.record_firing(db_rule.id);
                    if throttle.is_throttled(
                        db_rule.id,
                        std::time::Duration::from_secs(db_rule.cooldown_secs as u64),
                    ) {
                        continue;
                    }

                    let resolved_rule = ResolvedAlertRule {
                        id: db_rule.id,
                        tenant_id: tid,
                        name: db_rule.name.clone(),
                        condition: condition.clone(),
                        channels: channels.clone(),
                        cooldown_secs: db_rule.cooldown_secs as u64,
                    };

                    let severity = db_rule
                        .severity_override
                        .as_deref()
                        .unwrap_or(determine_severity(condition));
                    let summary = generate_summary(&resolved_rule, &ctx);
                    let mut details = alerting::engine::generate_details(condition, &ctx);
                    if silenced {
                        details["silenced"] = serde_json::Value::Bool(true);
                    }
                    let condition_type =
                        Some(alerting::engine::condition_type_str(condition).to_string());

                    let alert = FiredAlert {
                        id: Uuid::new_v4(),
                        rule_id: db_rule.id,
                        tenant_id: tid,
                        rule_name: db_rule.name.clone(),
                        condition_type,
                        severity: severity.to_string(),
                        summary: summary.clone(),
                        details: details.clone(),
                        fired_at: chrono::Utc::now().timestamp() as f64,
                    };

                    tracing::info!(
                        rule = %db_rule.name,
                        severity,
                        silenced,
                        tenant_id = %tid,
                        "Alert fired: {summary}"
                    );

                    // Send to accepting channels (severity floor, not muted by
                    // a silence) and collect delivery results, keyed per
                    // delivery (type:integration_id) so same-kind integrations
                    // don't overwrite each other.
                    let mut delivery_log = std::collections::HashMap::new();
                    let mut failed: Vec<(
                        alerting::rules::AlertChannel,
                        alerting::channels::SendResult,
                    )> = Vec::new();
                    if !silenced {
                        for channel in channels.iter().filter(|c| {
                            alerting::recovery::channel_accepts(c.min_severity(), severity)
                        }) {
                            let result = alert_dispatch::deliver_channel(
                                state,
                                &state.http,
                                tenant,
                                &integrations,
                                channel,
                                &alert,
                            )
                            .await;
                            delivery_log.insert(
                                result.delivery_key(),
                                ChannelDeliveryStatus {
                                    success: result.success,
                                    error: result.error.clone(),
                                },
                            );
                            if !result.success {
                                failed.push((channel.clone(), result));
                            }
                        }
                    }

                    // Record the incident, then queue retries for transient
                    // delivery failures against its history row.
                    match db::postgres::alert_rules::record_alert_fired(
                        &state.pg,
                        tid,
                        db_rule.id,
                        severity,
                        &summary,
                        &details,
                        &delivery_log,
                    )
                    .await
                    {
                        Ok(row) => {
                            for (channel, result) in &failed {
                                alert_dispatch::maybe_schedule_retry(
                                    state, tid, row.id, 1, channel, &alert, result,
                                )
                                .await;
                            }
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, rule = %db_rule.name, "failed to record alert history");
                        }
                    }

                    let _ = state.event_tx.send(TenantEvent {
                        tenant_id: tid,
                        payload: state::EventPayload::AlertFired {
                            rule_id: db_rule.id,
                            rule_name: db_rule.name.clone(),
                            severity: severity.to_string(),
                            summary: summary.clone(),
                        },
                    });

                    throttle.record_fired(db_rule.id);
                }

                // Open incident evaluating clear: resolve after two
                // consecutive clear passes so a hovering metric doesn't
                // ping-pong fired/resolved notifications.
                (false, Some(since)) => {
                    if !resolver.record_clear(db_rule.id) {
                        continue;
                    }
                    let _ = db::postgres::alert_rules::resolve_alerts_for_rule(
                        &state.pg, tid, db_rule.id,
                    )
                    .await;
                    resolver.forget(db_rule.id);

                    let firing_secs = (chrono::Utc::now() - since).num_seconds().max(0) as f64;
                    let summary = format!(
                        "Alert '{}' resolved (was firing for {})",
                        db_rule.name,
                        common::time::format_duration_secs(firing_secs)
                    );
                    tracing::info!(rule = %db_rule.name, tenant_id = %tid, "{summary}");

                    let notice = FiredAlert {
                        id: Uuid::new_v4(),
                        rule_id: db_rule.id,
                        tenant_id: tid,
                        rule_name: db_rule.name.clone(),
                        condition_type: Some(
                            alerting::engine::condition_type_str(condition).to_string(),
                        ),
                        severity: "resolved".to_string(),
                        summary: summary.clone(),
                        details: serde_json::json!({
                            "firing_duration_seconds": firing_secs,
                        }),
                        fired_at: chrono::Utc::now().timestamp() as f64,
                    };
                    // Best-effort: resolve notices aren't retried. They go to
                    // the channels that would have received the fire (severity
                    // floor applies to the incident's severity, not
                    // "resolved") and are held during a silence.
                    let fire_severity = db_rule
                        .severity_override
                        .as_deref()
                        .unwrap_or(determine_severity(condition));
                    if !silenced {
                        for channel in channels.iter().filter(|c| {
                            alerting::recovery::channel_accepts(c.min_severity(), fire_severity)
                        }) {
                            let _ = alert_dispatch::deliver_channel(
                                state,
                                &state.http,
                                tenant,
                                &integrations,
                                channel,
                                &notice,
                            )
                            .await;
                        }
                    }

                    let _ = state.event_tx.send(TenantEvent {
                        tenant_id: tid,
                        payload: state::EventPayload::AlertResolved {
                            rule_id: db_rule.id,
                            rule_name: db_rule.name.clone(),
                            summary,
                        },
                    });
                }

                // Quiet and nothing open: drop any leftover streak state.
                (false, None) => {
                    resolver.forget(db_rule.id);
                }
            }
        }
    }

    // Periodic cleanup of expired throttle entries (max cooldown = 1 hour)
    throttle.cleanup(std::time::Duration::from_secs(3600));

    Ok(())
}

async fn enforce_retention(state: &AppState) -> Result<(), String> {
    // Gather all tenants' retention policies and apply the shortest per table.
    // ClickHouse TTL is table-level (not per-partition), so we use the minimum
    // across all tenants. Per-tenant pruning can be done via DELETE in the future.
    let tenants =
        db::postgres::tenants::list_tenants(&state.pg, 1000, 0).await.map_err(|e| e.to_string())?;

    let mut min_task_days: u32 = 90; // default from migration
    let mut min_worker_days: u32 = 30;

    for tenant in &tenants {
        let policies = db::postgres::retention::list_retention_policies(&state.pg, tenant.id)
            .await
            .unwrap_or_default();
        for p in &policies {
            match p.resource_type.as_str() {
                "task_events" => {
                    min_task_days = min_task_days.min(p.retention_days as u32);
                }
                "worker_events" => {
                    min_worker_days = min_worker_days.min(p.retention_days as u32);
                }
                _ => {}
            }
        }
    }

    db::clickhouse::retention::apply_table_ttl(&state.ch, "task_events", min_task_days).await?;
    db::clickhouse::retention::apply_table_ttl(&state.ch, "worker_events", min_worker_days).await?;

    tracing::info!(
        task_events_days = min_task_days,
        worker_events_days = min_worker_days,
        "Retention enforcement applied"
    );
    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c().await.expect("Failed to listen for Ctrl+C");
    tracing::info!("Shutdown signal received");
}
