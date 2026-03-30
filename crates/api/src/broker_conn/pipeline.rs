use std::collections::HashMap;
use uuid::Uuid;

use crate::routes::responses::WorkerState;
use crate::state::{AppState, EventPayload, TenantEvent};
use common::{RawTaskEvent, RawWorkerEvent};

/// Ingest raw task events into the Feloxi pipeline.
///
/// This is the shared event pipeline used by broker connection consumers. It:
/// 1. Normalizes raw events into ClickHouse rows
/// 2. Inserts into ClickHouse
/// 3. Broadcasts to dashboard WebSocket clients
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

    // Normalize into ClickHouse rows
    let task_rows: Vec<_> = raw_events
        .iter()
        .map(|e| {
            engine::event_processor::normalize_task_event(tenant_id, source_id, broker_type, e)
        })
        .collect();

    // Insert into ClickHouse
    if let Err(e) = db::clickhouse::task_events::insert_task_events(&state.ch, &task_rows).await {
        tracing::error!(?e, "Failed to insert task events into ClickHouse");
    }

    // Broadcast to dashboard WebSocket clients
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
    // With 50K workers sending heartbeats, a single batch can have thousands of redundant
    // heartbeats for the same worker. We only need the latest state per worker.
    let mut latest_per_worker: HashMap<&str, &RawWorkerEvent> = HashMap::new();
    // Collect state-transition events (online/offline) separately — these always get stored.
    let mut transitions: Vec<&RawWorkerEvent> = Vec::new();

    for event in &raw_events {
        if event.event_type == "worker-online" || event.event_type == "worker-offline" {
            transitions.push(event);
        }
        // Always track latest — heartbeat or transition, we want the newest state
        latest_per_worker
            .entry(event.worker_id.as_str())
            .and_modify(|existing| {
                if event.timestamp > existing.timestamp {
                    *existing = event;
                }
            })
            .or_insert(event);
    }

    // --- Step 2: Store state transitions in ClickHouse (always) ---
    // Also store sampled heartbeats (1 per worker per 30s) for gap analysis.
    {
        let mut rows_to_store: Vec<_> = transitions
            .iter()
            .map(|e| engine::event_processor::normalize_worker_event(tenant_id, source_id, e))
            .collect();

        // Sample heartbeats: throttle via Redis SET NX (30s per worker)
        for event in latest_per_worker.values() {
            if event.event_type == "worker-heartbeat" {
                if let Ok(true) = db::redis::cache::should_sample_heartbeat(
                    &state.redis,
                    tenant_id,
                    &event.worker_id,
                )
                .await
                {
                    rows_to_store.push(
                        engine::event_processor::normalize_worker_event(
                            tenant_id, source_id, event,
                        ),
                    );
                }
            }
        }

        if !rows_to_store.is_empty() {
            if let Err(e) =
                db::clickhouse::worker_events::insert_worker_events(&state.ch, &rows_to_store)
                    .await
            {
                tracing::error!(?e, "Failed to insert worker events into ClickHouse");
            }
        }
    }

    // --- Step 3: Update Redis with deduplicated worker state ---
    // Instead of 3 Redis ops × N heartbeats, we do 3 ops × unique_workers.
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
