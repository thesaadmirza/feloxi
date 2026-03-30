use std::time::Duration;

use fred::prelude::*;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::kombu;
use super::pipeline;
use crate::state::AppState;

pub async fn run_redis_consumer(
    state: AppState,
    tenant_id: Uuid,
    config_id: Uuid,
    broker_url: String,
    cancel: CancellationToken,
) {
    tracing::info!(%tenant_id, %config_id, "Starting Redis broker consumer");

    let redis_config = match Config::from_url(&broker_url) {
        Ok(c) => c,
        Err(e) => {
            let err = format!("Invalid Redis URL: {e}");
            tracing::error!(%config_id, "{}", err);
            let _ = db::postgres::broker_configs::update_broker_config_status(
                &state.pg,
                config_id,
                "error",
                Some(&err),
            )
            .await;
            return;
        }
    };

    let mut builder = Builder::from_config(redis_config.clone());
    builder.set_policy(ReconnectPolicy::new_exponential(0, 100, 30_000, 2));
    let client = match builder.build_pool(3) {
        Ok(c) => c,
        Err(e) => {
            let err = format!("Failed to build Redis client: {e}");
            tracing::error!(%config_id, "{}", err);
            let _ = db::postgres::broker_configs::update_broker_config_status(
                &state.pg,
                config_id,
                "error",
                Some(&err),
            )
            .await;
            return;
        }
    };

    if let Err(e) = client.init().await {
        let err = format!("Failed to connect to Redis broker: {e}");
        tracing::error!(%config_id, "{}", err);
        let _ = db::postgres::broker_configs::update_broker_config_status(
            &state.pg,
            config_id,
            "error",
            Some(&err),
        )
        .await;
        return;
    }

    let subscriber = {
        let mut sub_builder = Builder::from_config(redis_config);
        sub_builder.set_policy(ReconnectPolicy::new_exponential(0, 100, 30_000, 2));
        let pubsub_capacity = std::env::var("FP_PUBSUB_CHANNEL_CAPACITY")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(10_000);
        sub_builder.set_performance_config(PerformanceConfig {
            broadcast_channel_capacity: pubsub_capacity,
            ..Default::default()
        });
        match sub_builder.build_subscriber_client() {
            Ok(s) => s,
            Err(e) => {
                let err = format!("Failed to build subscriber client: {e}");
                tracing::error!(%config_id, "{}", err);
                let _ = db::postgres::broker_configs::update_broker_config_status(
                    &state.pg,
                    config_id,
                    "error",
                    Some(&err),
                )
                .await;
                return;
            }
        }
    };

    if let Err(e) = subscriber.init().await {
        let err = format!("Failed to connect subscriber: {e}");
        tracing::error!(%config_id, "{}", err);
        let _ = db::postgres::broker_configs::update_broker_config_status(
            &state.pg,
            config_id,
            "error",
            Some(&err),
        )
        .await;
        return;
    }

    let _manage_handle = subscriber.manage_subscriptions();

    let db_number = parse_redis_db(&broker_url);
    let pattern_with_db = format!("/{db_number}.celeryev/*");
    let pattern_plain = "/celeryev/*".to_string();

    if let Err(e) =
        subscriber.psubscribe::<Vec<String>>(vec![pattern_with_db.clone(), pattern_plain]).await
    {
        tracing::warn!(%config_id, "psubscribe failed: {e}");
    }

    tracing::info!(%config_id, %db_number, "Subscribed to celeryev pubsub channels");

    let _ = db::postgres::broker_configs::update_broker_config_status(
        &state.pg,
        config_id,
        "connected",
        None,
    )
    .await;

    tracing::info!(%config_id, "Connected to Redis broker");

    let mut message_rx = subscriber.message_rx();
    let flush_secs = env_or("FP_FLUSH_INTERVAL_SECS", 1u64);
    let drain_secs = env_or("FP_DRAIN_INTERVAL_SECS", 30u64);
    let drain_max: usize = env_or("FP_DRAIN_MAX_MESSAGES", 500usize);
    let stats_secs = env_or("FP_STATS_INTERVAL_SECS", 30u64);
    let task_batch_cap: usize = env_or("FP_TASK_BATCH_SIZE", 100usize);
    let worker_batch_cap: usize = env_or("FP_WORKER_BATCH_SIZE", 20usize);
    let mut task_batch = Vec::with_capacity(task_batch_cap);
    let mut worker_batch = Vec::with_capacity(worker_batch_cap);
    let mut flush_interval = tokio::time::interval(Duration::from_secs(flush_secs));
    let mut events_since_log: u64 = 0;
    let mut last_stats = tokio::time::Instant::now();
    let mut last_drain = tokio::time::Instant::now();

    loop {
        tokio::select! {
            biased;

            _ = cancel.cancelled() => {
                tracing::info!(%config_id, "Redis consumer shutting down");
                break;
            }
            msg = message_rx.recv() => {
                match msg {
                    Ok(message) => {
                        let payload: String = match message.value.convert() {
                            Ok(s) => s,
                            Err(_) => continue,
                        };

                        process_pubsub_payload(&payload, &mut task_batch, &mut worker_batch);

                        if task_batch.len() >= task_batch_cap {
                            let events = std::mem::take(&mut task_batch);
                            events_since_log += events.len() as u64;
                            pipeline::ingest_raw_task_events(
                                &state, tenant_id, config_id, "celery", events,
                            ).await;
                        }
                        if worker_batch.len() >= worker_batch_cap {
                            let events = std::mem::take(&mut worker_batch);
                            events_since_log += events.len() as u64;
                            pipeline::ingest_raw_worker_events(
                                &state, tenant_id, config_id, events,
                            ).await;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(%config_id, skipped = n, "PubSub receiver lagged");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        tracing::warn!(%config_id, "PubSub message stream closed");
                        break;
                    }
                }
            }
            _ = flush_interval.tick() => {
                flush_batches(
                    &state, tenant_id, config_id,
                    &mut task_batch, &mut worker_batch,
                    &mut events_since_log,
                ).await;

                if last_drain.elapsed() >= Duration::from_secs(drain_secs) {
                    drain_list_queues(&client, &mut task_batch, &mut worker_batch, drain_max).await;
                    last_drain = tokio::time::Instant::now();
                }

                if last_stats.elapsed() >= Duration::from_secs(stats_secs) {
                    let rate = events_since_log as f64 / last_stats.elapsed().as_secs_f64();
                    tracing::info!(
                        %config_id,
                        events = events_since_log,
                        rate_per_sec = format!("{rate:.0}"),
                        "Consumer throughput"
                    );
                    events_since_log = 0;
                    last_stats = tokio::time::Instant::now();
                }
            }
        }
    }

    if !task_batch.is_empty() {
        pipeline::ingest_raw_task_events(&state, tenant_id, config_id, "celery", task_batch).await;
    }
    if !worker_batch.is_empty() {
        pipeline::ingest_raw_worker_events(&state, tenant_id, config_id, worker_batch).await;
    }

    let _ = subscriber.unsubscribe_all().await;
    let _ = db::postgres::broker_configs::update_broker_config_status(
        &state.pg,
        config_id,
        "disconnected",
        None,
    )
    .await;
}

fn env_or<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

use super::commands::parse_redis_db;

async fn flush_batches(
    state: &AppState,
    tenant_id: Uuid,
    config_id: Uuid,
    task_batch: &mut Vec<common::RawTaskEvent>,
    worker_batch: &mut Vec<common::RawWorkerEvent>,
    events_since_log: &mut u64,
) {
    if !task_batch.is_empty() {
        let events = std::mem::take(task_batch);
        *events_since_log += events.len() as u64;
        pipeline::ingest_raw_task_events(state, tenant_id, config_id, "celery", events).await;
    }
    if !worker_batch.is_empty() {
        let events = std::mem::take(worker_batch);
        *events_since_log += events.len() as u64;
        pipeline::ingest_raw_worker_events(state, tenant_id, config_id, events).await;
    }
}

fn process_pubsub_payload(
    raw: &str,
    task_batch: &mut Vec<common::RawTaskEvent>,
    worker_batch: &mut Vec<common::RawWorkerEvent>,
) {
    // Try Kombu envelope first (handles base64 body decoding)
    if let Some(body) = kombu::decode_kombu_body(raw) {
        if let Some(arr) = body.as_array() {
            // Array of events (task.multi batched payload)
            for item in arr {
                let event_val = if let Some(s) = item.as_str() {
                    serde_json::from_str::<serde_json::Value>(s).ok()
                } else {
                    Some(item.clone())
                };
                if let Some(val) = event_val {
                    if let Some(parsed) = classify_event(&val) {
                        route_parsed_event(parsed, task_batch, worker_batch);
                    }
                }
            }
        } else {
            // Single event object
            if let Some(parsed) = classify_event(&body) {
                route_parsed_event(parsed, task_batch, worker_batch);
            }
        }
        return;
    }

    // Fallback: raw JSON array (non-Kombu format)
    if let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(raw) {
        for item in &items {
            let item_str =
                if let Some(s) = item.as_str() { s.to_string() } else { item.to_string() };
            if let Some(parsed) = parse_raw_message(&item_str) {
                route_parsed_event(parsed, task_batch, worker_batch);
            }
        }
        return;
    }

    // Fallback: single raw JSON event
    if let Some(parsed) = parse_raw_message(raw) {
        route_parsed_event(parsed, task_batch, worker_batch);
    }
}

enum ParsedEvent {
    Task(common::RawTaskEvent),
    Worker(common::RawWorkerEvent),
}

fn route_parsed_event(
    event: ParsedEvent,
    task_batch: &mut Vec<common::RawTaskEvent>,
    worker_batch: &mut Vec<common::RawWorkerEvent>,
) {
    match event {
        ParsedEvent::Task(e) => task_batch.push(e),
        ParsedEvent::Worker(e) => worker_batch.push(e),
    }
}

fn classify_event(body: &serde_json::Value) -> Option<ParsedEvent> {
    let event_type = body.get("type").and_then(|v| v.as_str()).unwrap_or("unknown");

    if event_type.starts_with("task-") {
        common::parse_celery_event(event_type, body).map(ParsedEvent::Task)
    } else if event_type.starts_with("worker-") {
        common::parse_celery_worker_event(event_type, body).map(ParsedEvent::Worker)
    } else {
        tracing::debug!("Unknown event type: {event_type}");
        None
    }
}

fn parse_raw_message(raw_msg: &str) -> Option<ParsedEvent> {
    let (event_type, body) = if let Some(body) = kombu::decode_kombu_body(raw_msg) {
        let et = body
            .get("type")
            .and_then(|v| v.as_str())
            .map(String::from)
            .or_else(|| kombu::extract_event_type(raw_msg))
            .unwrap_or_else(|| "unknown".to_string());
        (et, body)
    } else {
        let body: serde_json::Value = match serde_json::from_str(raw_msg) {
            Ok(v) => v,
            Err(e) => {
                tracing::debug!(
                    "Failed to parse raw message as JSON: {e}, raw: {}",
                    &raw_msg[..raw_msg.len().min(200)]
                );
                return None;
            }
        };
        let et = body.get("type").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
        (et, body)
    };

    if event_type.starts_with("task-") {
        let result = common::parse_celery_event(&event_type, &body);
        if result.is_none() {
            tracing::debug!(
                "parse_celery_event returned None for type={event_type}, body keys: {:?}",
                body.as_object().map(|o| o.keys().collect::<Vec<_>>())
            );
        }
        result.map(ParsedEvent::Task)
    } else if event_type.starts_with("worker-") {
        let result = common::parse_celery_worker_event(&event_type, &body);
        if result.is_none() {
            tracing::debug!("parse_celery_worker_event returned None for type={event_type}");
        }
        result.map(ParsedEvent::Worker)
    } else {
        tracing::debug!("Unknown event type: {event_type}");
        None
    }
}

async fn drain_list_queues(
    client: &Pool,
    task_batch: &mut Vec<common::RawTaskEvent>,
    worker_batch: &mut Vec<common::RawWorkerEvent>,
    max_drain: usize,
) {
    let queues = discover_celery_queues(client).await;
    if queues.is_empty() {
        return;
    }

    let mut drained = 0;
    for key in &queues {
        while drained < max_drain {
            let result: Result<Option<String>, _> = client.rpop(key.as_str(), None).await;
            match result {
                Ok(Some(raw_msg)) => {
                    if let Some(parsed) = parse_raw_message(&raw_msg) {
                        route_parsed_event(parsed, task_batch, worker_batch);
                    }
                    drained += 1;
                }
                _ => break,
            }
        }
        if drained >= max_drain {
            break;
        }
    }
}

async fn discover_celery_queues(client: &Pool) -> Vec<String> {
    let binding_key = "_kombu.binding.celeryev";

    let members: Vec<String> = match client.smembers(binding_key).await {
        Ok(m) => m,
        Err(_) => return vec![],
    };

    let mut queues = Vec::new();
    for member in &members {
        if let Some(queue_name) = member.split('\t').next() {
            if !queue_name.is_empty() {
                queues.push(queue_name.to_string());
            }
        }
    }

    if queues.is_empty() {
        queues.push("celeryev".to_string());
    }

    queues.dedup();
    queues
}

pub async fn test_redis_connection(url: &str) -> Result<(), String> {
    let config = Config::from_url(url).map_err(|e| format!("Invalid Redis URL: {e}"))?;
    let mut builder = Builder::from_config(config);
    builder.set_policy(ReconnectPolicy::new_constant(0, 3000));
    let client = builder.build_pool(1).map_err(|e| format!("Failed to build client: {e}"))?;

    tokio::time::timeout(Duration::from_secs(5), client.init())
        .await
        .map_err(|_| "Connection timed out after 5 seconds".to_string())?
        .map_err(|e| format!("Failed to connect: {e}"))?;

    let _: String = client.ping::<String>(None).await.map_err(|e| format!("PING failed: {e}"))?;

    Ok(())
}
