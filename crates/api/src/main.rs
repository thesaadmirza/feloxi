use std::sync::Arc;

use anyhow::Result;
use tokio::sync::broadcast;
use tracing_subscriber::{fmt, EnvFilter};
use uuid::Uuid;

mod app;
mod broker_conn;
mod openapi;
mod routes;
mod smtp;
mod state;
mod ws;

use smtp::tenant_smtp_config;

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

    let state = AppState {
        pg,
        ch,
        redis,
        event_tx,
        broker_manager,
        config: Arc::new(config.clone()),
        jwt_keys: Arc::new(auth::jwt::JwtKeys::new(config.jwt_secret.as_bytes())),
        health_cache: Arc::new(HealthCache::new(std::time::Duration::from_secs(5))),
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
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("Failed to build HTTP client");

        loop {
            interval.tick().await;
            if let Err(e) = run_alert_evaluation(&s, &mut throttle, &http_client).await {
                tracing::warn!(error = %e, "Alert evaluation cycle failed");
            }
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
    http_client: &reqwest::Client,
) -> Result<(), String> {
    use alerting::{
        engine::{determine_severity, evaluate_condition, generate_summary, FiredAlert},
        rules::{AlertChannel, ResolvedAlertRule},
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

        if db_rules.is_empty() {
            continue;
        }

        // Build evaluation context from ClickHouse metrics
        let ctx = build_evaluation_context(state, tid).await;

        for db_rule in &db_rules {
            // condition and channels are already concrete types (via sqlx::types::Json<T>)
            let condition = &db_rule.condition.0;
            let channels = &db_rule.channels.0;

            // Check cooldown
            if throttle.is_throttled(
                db_rule.id,
                std::time::Duration::from_secs(db_rule.cooldown_secs as u64),
            ) {
                continue;
            }

            let resolved = ResolvedAlertRule {
                id: db_rule.id,
                tenant_id: tid,
                name: db_rule.name.clone(),
                condition: condition.clone(),
                channels: channels.clone(),
                cooldown_secs: db_rule.cooldown_secs as u64,
            };

            // Evaluate
            if !evaluate_condition(condition, &ctx) {
                continue;
            }

            // Fire!
            let severity = determine_severity(condition);
            let summary = generate_summary(&resolved, &ctx);

            let details = alerting::engine::generate_details(condition, &ctx);
            let condition_type = Some(alerting::engine::condition_type_str(condition).to_string());

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
                tenant_id = %tid,
                "Alert fired: {summary}"
            );

            // Send to all channels and collect delivery results
            let mut delivery_log = std::collections::HashMap::new();
            for channel in channels {
                let result = match channel {
                    AlertChannel::Slack { webhook_url } => {
                        alerting::channels::slack::send_slack_alert(
                            http_client,
                            webhook_url,
                            &alert,
                        )
                        .await
                    }
                    AlertChannel::Webhook { url, headers } => {
                        alerting::channels::webhook::send_webhook_alert(
                            http_client,
                            url,
                            headers,
                            &alert,
                        )
                        .await
                    }
                    AlertChannel::PagerDuty { routing_key } => {
                        alerting::channels::pagerduty::send_pagerduty_alert(
                            http_client,
                            routing_key,
                            &alert,
                        )
                        .await
                    }
                    AlertChannel::Email { to } => {
                        let smtp_cfg = tenant_smtp_config(tenant);
                        alerting::channels::email::send_email_alert(to, &alert, &smtp_cfg).await
                    }
                };

                delivery_log.insert(
                    result.channel_type.clone(),
                    ChannelDeliveryStatus { success: result.success, error: result.error },
                );
            }

            // Record in DB
            let _ = db::postgres::alert_rules::record_alert_fired(
                &state.pg,
                tid,
                db_rule.id,
                severity,
                &summary,
                &details,
                &delivery_log,
            )
            .await;

            // Record in throttle
            throttle.record_fired(db_rule.id);
        }
    }

    // Periodic cleanup of expired throttle entries (max cooldown = 1 hour)
    throttle.cleanup(std::time::Duration::from_secs(3600));

    Ok(())
}

/// Build an EvaluationContext for a tenant from ClickHouse metrics.
async fn build_evaluation_context(
    state: &AppState,
    tenant_id: Uuid,
) -> alerting::engine::EvaluationContext {
    use alerting::engine::EvaluationContext;

    let mut ctx = EvaluationContext::default();

    // Get overview stats (last 5 minutes for real-time alerting)
    if let Ok(stats) =
        db::clickhouse::aggregations::get_overview_stats(&state.ch, tenant_id, 5).await
    {
        if stats.total_tasks > 0 {
            ctx.failure_rate = stats.failure_count as f64 / stats.total_tasks as f64;
        }
        ctx.p95_runtime = stats.p95_runtime;
        ctx.recent_failures = stats.failure_count;
    }

    // Only flag worker-offline if the tenant has active brokers (avoids false positives
    // for tenants that have never connected any workers)
    if let Ok(online) = db::redis::cache::get_online_workers(&state.redis, tenant_id).await {
        if online.is_empty() {
            let has_active_broker =
                db::postgres::broker_configs::list_broker_configs(&state.pg, tenant_id)
                    .await
                    .map(|configs| configs.iter().any(|c| c.is_active))
                    .unwrap_or(false);

            if has_active_broker {
                ctx.workers_went_offline = 1;
            }
        }
    }

    ctx
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
