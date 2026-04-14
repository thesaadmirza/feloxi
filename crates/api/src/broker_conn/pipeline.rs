use std::collections::HashMap;
use std::time::Duration;

use uuid::Uuid;

use crate::routes::responses::WorkerState;
use crate::state::{AppState, EventPayload, TenantEvent};
use common::{RawTaskEvent, RawWorkerEvent};

/// Ingest raw task events into the Feloxi pipeline.
///
/// Normalizes, inserts into ClickHouse (with in-flight retry + Redis-buffered
/// replay on failure), updates Redis pipeline counters, and broadcasts to
/// dashboard WebSocket clients.
pub async fn ingest_raw_task_events(
    state: &AppState,
    tenant_id: Uuid,
    source_id: Uuid,
    broker_type: &str,
    raw_events: Vec<RawTaskEvent>,
) {
    if raw_events.is_empty() {
        return;
    }

    let batch_size = raw_events.len() as u64;
    let _ =
        db::redis::cache::incr_pipeline_counter(&state.redis, "events_received", batch_size).await;

    // Normalize into ClickHouse rows
    let task_rows: Vec<_> = raw_events
        .iter()
        .map(|e| {
            engine::event_processor::normalize_task_event(tenant_id, source_id, broker_type, e)
        })
        .collect();

    let inserted = insert_with_retry(state, &task_rows).await;

    if inserted {
        let _ =
            db::redis::cache::incr_pipeline_counter(&state.redis, "events_inserted", batch_size)
                .await;
    }

    // Broadcast to dashboard WebSocket clients (independent of CH success)
    for event in &raw_events {
        let _ = state.event_tx.send(TenantEvent {
            tenant_id,
            payload: EventPayload::TaskUpdate {
                task_id: event.task_id.clone(),
                task_name: event.task_name.clone(),
                state: event.state.clone().unwrap_or_default(),
                queue: event.queue.clone().unwrap_or_default(),
                worker_id: event.worker_id.clone().unwrap_or_default(),
                runtime: event.runtime,
                timestamp: event.timestamp,
            },
        });
    }
}

/// Ingest raw worker events into the Feloxi pipeline.
///
/// Optimized for high-throughput deployments (50K+ workers):
/// 1. Deduplicates heartbeats — keeps only latest event per worker_id
/// 2. Only stores state transitions (online/offline) in ClickHouse, not heartbeats
/// 3. Updates Redis worker state with deduplicated batch
/// 4. Broadcasts deduplicated updates to dashboard WebSocket clients
pub async fn ingest_raw_worker_events(
    state: &AppState,
    tenant_id: Uuid,
    source_id: Uuid,
    raw_events: Vec<RawWorkerEvent>,
) {
    if raw_events.is_empty() {
        return;
    }

    // --- Step 1: Deduplicate by worker_id, keeping only the latest event per worker ---
    let mut latest_per_worker: HashMap<&str, &RawWorkerEvent> = HashMap::new();
    let mut transitions: Vec<&RawWorkerEvent> = Vec::new();

    for event in &raw_events {
        if event.event_type == "worker-online" || event.event_type == "worker-offline" {
            transitions.push(event);
        }
        latest_per_worker
            .entry(event.worker_id.as_str())
            .and_modify(|existing| {
                if event.timestamp > existing.timestamp {
                    *existing = event;
                }
            })
            .or_insert(event);
    }

    // --- Step 2: Store state transitions + sampled heartbeats in ClickHouse ---
    {
        let mut rows_to_store: Vec<_> = transitions
            .iter()
            .map(|e| engine::event_processor::normalize_worker_event(tenant_id, source_id, e))
            .collect();

        for event in latest_per_worker.values() {
            if event.event_type == "worker-heartbeat" {
                if let Ok(true) = db::redis::cache::should_sample_heartbeat(
                    &state.redis,
                    tenant_id,
                    &event.worker_id,
                )
                .await
                {
                    rows_to_store.push(engine::event_processor::normalize_worker_event(
                        tenant_id, source_id, event,
                    ));
                }
            }
        }

        if !rows_to_store.is_empty() {
            let batch_size = rows_to_store.len() as u64;
            let _ = db::redis::cache::incr_pipeline_counter(
                &state.redis,
                "events_received",
                batch_size,
            )
            .await;

            let inserted = insert_worker_with_retry(state, &rows_to_store).await;

            if inserted {
                let _ = db::redis::cache::incr_pipeline_counter(
                    &state.redis,
                    "events_inserted",
                    batch_size,
                )
                .await;
            }
        }
    }

    // --- Step 3: Update Redis with deduplicated worker state ---
    for event in latest_per_worker.values() {
        if event.event_type == "worker-offline" {
            let _ = db::redis::cache::set_worker_offline(&state.redis, tenant_id, &event.worker_id)
                .await;
        } else {
            let worker_state = WorkerState {
                worker_id: event.worker_id.clone(),
                hostname: event.hostname.clone(),
                status: "online".to_string(),
                active_tasks: event.active_tasks.unwrap_or(0),
                processed: event.processed.unwrap_or(0),
                load_avg: event.load_avg.clone().unwrap_or_default(),
                cpu_percent: event.cpu_percent.unwrap_or(0.0),
                memory_mb: event.memory_mb.unwrap_or(0.0),
                pool_size: event.pool_size.unwrap_or(0),
                pool_type: event.pool_type.clone().unwrap_or_default(),
                sw_ident: event.sw_ident.clone().unwrap_or_default(),
                sw_ver: event.sw_ver.clone().unwrap_or_default(),
            };
            let _ = db::redis::cache::set_worker_state(
                &state.redis,
                tenant_id,
                &event.worker_id,
                &worker_state,
            )
            .await;
        }
    }

    // --- Step 4: Broadcast deduplicated updates to WebSocket clients ---
    for event in latest_per_worker.values() {
        let _ = state.event_tx.send(TenantEvent {
            tenant_id,
            payload: EventPayload::WorkerUpdate {
                worker_id: event.worker_id.clone(),
                hostname: event.hostname.clone(),
                status: event.event_type.clone(),
                active_tasks: event.active_tasks.unwrap_or(0),
                cpu_percent: event.cpu_percent.unwrap_or(0.0),
                memory_mb: event.memory_mb.unwrap_or(0.0),
            },
        });
    }
}

/// Returns true if the batch was persisted to ClickHouse on the first try or
/// after the in-flight retry. Returns false if it was buffered for background
/// replay — or truly dropped when the buffer itself is unreachable.
async fn insert_with_retry(
    state: &AppState,
    task_rows: &[db::clickhouse::task_events::TaskEventRow],
) -> bool {
    let first = db::clickhouse::task_events::insert_task_events(&state.ch, task_rows).await;

    if first.is_ok() {
        return true;
    }

    // Retry once after 100ms — handles transient hiccups without engaging the buffer.
    let _ = db::redis::cache::incr_pipeline_counter(&state.redis, "insert_retries", 1).await;
    tokio::time::sleep(Duration::from_millis(100)).await;

    if let Err(e) = db::clickhouse::task_events::insert_task_events(&state.ch, task_rows).await {
        buffer_for_retry(state, db::redis::keys::RETRY_KIND_TASK, task_rows, &e).await;
        return false;
    }
    true
}

/// Worker-event twin of [`insert_with_retry`]; same buffering semantics.
async fn insert_worker_with_retry(
    state: &AppState,
    rows: &[db::clickhouse::worker_events::WorkerEventRow],
) -> bool {
    let first = db::clickhouse::worker_events::insert_worker_events(&state.ch, rows).await;

    if first.is_ok() {
        return true;
    }

    let _ = db::redis::cache::incr_pipeline_counter(&state.redis, "insert_retries", 1).await;
    tokio::time::sleep(Duration::from_millis(100)).await;

    if let Err(e) = db::clickhouse::worker_events::insert_worker_events(&state.ch, rows).await {
        buffer_for_retry(state, db::redis::keys::RETRY_KIND_WORKER, rows, &e).await;
        return false;
    }
    true
}

async fn buffer_for_retry<T: serde::Serialize>(
    state: &AppState,
    kind: &str,
    rows: &[T],
    ch_err: &common::AppError,
) {
    let count = rows.len() as u64;
    match db::redis::cache::push_retry_batch(&state.redis, kind, rows).await {
        Ok(_) => {
            tracing::warn!(
                count,
                kind,
                error = ?ch_err,
                "ClickHouse insert failed; batch buffered for replay"
            );
        }
        Err(buf_err) => {
            let _ = db::redis::cache::incr_pipeline_counter(&state.redis, "events_dropped", count)
                .await;
            tracing::error!(
                count,
                kind,
                error = ?buf_err,
                ch_error = ?ch_err,
                "Retry buffer unavailable; events dropped"
            );
        }
    }
}
