use std::time::Duration;

use fred::prelude::*;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::state::AppState;
use super::kombu;
use super::pipeline;

/// Consume Celery events from a Redis broker (Kombu transport).
///
/// Kombu (Celery's messaging abstraction) stores exchange bindings in a Redis SET
/// named `_kombu.binding.{exchange}`. For Celery events, the exchange is `celeryev`.
/// Each binding entry has the format `{queue}\t{routing_key}\t{pattern}`.
/// The actual messages are pushed to Redis LISTs with the queue name.
pub async fn run_redis_consumer(
    state: AppState,
    tenant_id: Uuid,
    config_id: Uuid,
    broker_url: String,
    cancel: CancellationToken,
) {
    tracing::info!(%tenant_id, %config_id, "Starting Redis broker consumer");

    // Connect to the user's Redis (separate from our internal Redis)
    let redis_config = match Config::from_url(&broker_url) {
        Ok(c) => c,
        Err(e) => {
            let err = format!("Invalid Redis URL: {e}");
            tracing::error!(%config_id, "{}", err);
            let _ = db::postgres::broker_configs::update_broker_config_status(
                &state.pg, config_id, "error", Some(&err),
            ).await;
            return;
        }
    };

    let mut builder = Builder::from_config(redis_config);
    builder.set_policy(ReconnectPolicy::new_exponential(0, 100, 30_000, 2));
    // Use a small pool (3 connections) for the user's broker — we only need RPOP + SMEMBERS.
    let client = match builder.build_pool(3) {
        Ok(c) => c,
        Err(e) => {
            let err = format!("Failed to build Redis client: {e}");
            tracing::error!(%config_id, "{}", err);
            let _ = db::postgres::broker_configs::update_broker_config_status(
                &state.pg, config_id, "error", Some(&err),
            ).await;
            return;
        }
    };

    if let Err(e) = client.init().await {
        let err = format!("Failed to connect to Redis broker: {e}");
        tracing::error!(%config_id, "{}", err);
        let _ = db::postgres::broker_configs::update_broker_config_status(
            &state.pg, config_id, "error", Some(&err),
        ).await;
        return;
    }

    // Mark as connected
    let _ = db::postgres::broker_configs::update_broker_config_status(
        &state.pg, config_id, "connected", None,
    ).await;

    tracing::info!(%config_id, "Connected to Redis broker");

    // Main consumer loop — drain up to 5000 events per iteration for high throughput.
    // Worker batch sized to handle 50K workers (one heartbeat each).
    let mut task_batch = Vec::with_capacity(5000);
    let mut worker_batch = Vec::with_capacity(5000);
    let mut events_since_log: u64 = 0;
    let mut last_stats = tokio::time::Instant::now();

    loop {
        if cancel.is_cancelled() {
            tracing::info!(%config_id, "Redis consumer shutting down");
            break;
        }

        let got_data = consume_events(&client, &mut task_batch, &mut worker_batch, 5000).await;
        let batch_size = task_batch.len() + worker_batch.len();

        if !task_batch.is_empty() {
            let events = std::mem::take(&mut task_batch);
            events_since_log += events.len() as u64;
            pipeline::ingest_raw_task_events(
                &state, tenant_id, config_id, "celery", events,
            ).await;
        }
        if !worker_batch.is_empty() {
            let events = std::mem::take(&mut worker_batch);
            events_since_log += events.len() as u64;
            pipeline::ingest_raw_worker_events(
                &state, tenant_id, config_id, events,
            ).await;
        }

        // Periodic throughput logging (every 30s)
        if last_stats.elapsed() >= Duration::from_secs(30) {
            let rate = events_since_log as f64 / last_stats.elapsed().as_secs_f64();
            tracing::info!(%config_id, events = events_since_log, rate_per_sec = format!("{rate:.0}"), "Consumer throughput");
            events_since_log = 0;
            last_stats = tokio::time::Instant::now();
        }

        if !got_data {
            // No events found; back off before retrying
            tokio::select! {
                _ = cancel.cancelled() => {
                    tracing::info!(%config_id, "Redis consumer shutting down");
                    break;
                }
                _ = tokio::time::sleep(Duration::from_secs(1)) => {}
            }
        } else if batch_size >= 5000 {
            // Backpressure: if we hit the drain limit, yield briefly to let the pipeline
            // catch up (ClickHouse inserts, Redis state updates). Without this, the tight
            // loop would starve other Tokio tasks.
            tokio::task::yield_now().await;
        }
    }

    // Flush remaining
    if !task_batch.is_empty() {
        pipeline::ingest_raw_task_events(
            &state, tenant_id, config_id, "celery", task_batch,
        ).await;
    }
    if !worker_batch.is_empty() {
        pipeline::ingest_raw_worker_events(
            &state, tenant_id, config_id, worker_batch,
        ).await;
    }

    let _ = db::postgres::broker_configs::update_broker_config_status(
        &state.pg, config_id, "disconnected", None,
    ).await;
}

/// A parsed broker event — either a task or worker event.
enum ParsedEvent {
    Task(common::RawTaskEvent),
    Worker(common::RawWorkerEvent),
}

/// Fast-drain events from all discovered queues using non-blocking RPOP.
/// Returns true if any events were found.
async fn consume_events(
    client: &Pool,
    task_batch: &mut Vec<common::RawTaskEvent>,
    worker_batch: &mut Vec<common::RawWorkerEvent>,
    max_drain: usize,
) -> bool {
    let queues = discover_celery_queues(client).await;
    if queues.is_empty() {
        return false;
    }

    let mut got_any = false;
    let mut drained = 0;

    // Fast non-blocking drain: RPOP in a tight loop from each queue
    for key in &queues {
        while drained < max_drain {
            // Use non-blocking RPOP (returns None immediately if queue is empty)
            let result: Result<Option<String>, _> = client.rpop(key.as_str(), None).await;
            match result {
                Ok(Some(raw_msg)) => {
                    match parse_raw_message(&raw_msg) {
                        Some(ParsedEvent::Task(e)) => {
                            task_batch.push(e);
                            got_any = true;
                        }
                        Some(ParsedEvent::Worker(e)) => {
                            worker_batch.push(e);
                            got_any = true;
                        }
                        None => {}
                    }
                    drained += 1;
                }
                _ => break, // Queue empty or error, try next queue
            }
        }
        if drained >= max_drain {
            break;
        }
    }

    got_any
}

/// Parse a raw Redis message (Kombu envelope or raw JSON) into a task or worker event.
fn parse_raw_message(raw_msg: &str) -> Option<ParsedEvent> {
    // Try to decode as Kombu envelope first
    let (event_type, body) = if let Some(body) = kombu::decode_kombu_body(raw_msg) {
        let et = body
            .get("type")
            .and_then(|v| v.as_str())
            .map(String::from)
            .or_else(|| kombu::extract_event_type(raw_msg))
            .unwrap_or_else(|| "unknown".to_string());
        (et, body)
    } else {
        // Maybe it's raw JSON (not a Kombu envelope)
        let body: serde_json::Value = match serde_json::from_str(raw_msg) {
            Ok(v) => v,
            Err(e) => {
                tracing::debug!("Failed to parse raw message as JSON: {e}, raw: {}", &raw_msg[..raw_msg.len().min(200)]);
                return None;
            }
        };
        let et = body
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        (et, body)
    };

    if event_type.starts_with("task-") {
        let result = common::parse_celery_event(&event_type, &body);
        if result.is_none() {
            tracing::debug!("parse_celery_event returned None for type={event_type}, body keys: {:?}", body.as_object().map(|o| o.keys().collect::<Vec<_>>()));
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

/// Discover Celery event queues from the Kombu binding set.
async fn discover_celery_queues(client: &Pool) -> Vec<String> {
    let binding_key = "_kombu.binding.celeryev";

    let members: Vec<String> = match client.smembers(binding_key).await {
        Ok(m) => m,
        Err(_) => return vec![],
    };

    let mut queues = Vec::new();
    for member in &members {
        // Kombu binding format: "queue_name\trouting_key\tpattern"
        if let Some(queue_name) = member.split('\t').next() {
            if !queue_name.is_empty() {
                queues.push(queue_name.to_string());
            }
        }
    }

    // If no bindings found, try common default queue name
    if queues.is_empty() {
        // Celery events might use a queue named "celeryev.*" or similar
        // Check for any keys matching the pattern
        queues.push("celeryev".to_string());
    }

    queues.dedup();
    queues
}

/// Test connectivity to a Redis broker URL.
pub async fn test_redis_connection(url: &str) -> Result<(), String> {
    let config = Config::from_url(url).map_err(|e| format!("Invalid Redis URL: {e}"))?;
    let mut builder = Builder::from_config(config);
    builder.set_policy(ReconnectPolicy::new_constant(0, 3000));
    let client = builder.build_pool(1).map_err(|e| format!("Failed to build client: {e}"))?;

    tokio::time::timeout(Duration::from_secs(5), client.init())
        .await
        .map_err(|_| "Connection timed out after 5 seconds".to_string())?
        .map_err(|e| format!("Failed to connect: {e}"))?;

    // Quick PING to verify
    let _: String = client
        .ping::<String>(None)
        .await
        .map_err(|e| format!("PING failed: {e}"))?;

    Ok(())
}
