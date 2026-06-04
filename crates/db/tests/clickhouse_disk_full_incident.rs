//! Reproduction of the production incident: ClickHouse disk filled up,
//! ingestion stopped, events were lost, and the operator was "blind" to how
//! many were lost.
//!
//! This is a FAITHFUL reproduction that drives the *real* resilience code in
//! `db::redis::cache` (the same `push_retry_batch` / `pop_retry_batches` /
//! pipeline counters that `crates/api/src/broker_conn/pipeline.rs` calls in
//! production). It does not mock the buffer.
//!
//! It requires a Redis reachable at `REDIS_TEST_URL` (default
//! `redis://127.0.0.1:6399/15`). The CI/dev harness starts one; if none is
//! reachable the tests skip with a clear message instead of failing.
//!
//! Run with:
//!     redis-server --port 6399 --save '' --appendonly no --daemonize yes
//!     cargo test -p db --test clickhouse_disk_full_incident -- --nocapture

use db::redis::{cache, keys};
use fred::prelude::*;

fn test_url() -> String {
    std::env::var("REDIS_TEST_URL").unwrap_or_else(|_| "redis://127.0.0.1:6399/15".to_string())
}

/// Connect to the test Redis, or return None so the test can skip cleanly when
/// no Redis is available (e.g. offline CI without the service).
async fn try_pool() -> Option<Pool> {
    let url = test_url();
    match db::redis::pool::create_redis_pool(&url).await {
        Ok(pool) => match pool.ping::<String>(None).await {
            Ok(_) => Some(pool),
            Err(_) => None,
        },
        Err(_) => None,
    }
}

macro_rules! pool_or_skip {
    () => {
        match try_pool().await {
            Some(p) => p,
            None => {
                eprintln!(
                    "SKIP: no Redis at {} (start one: redis-server --port 6399 --save '' --daemonize yes)",
                    test_url()
                );
                return;
            }
        }
    };
}

async fn reset(pool: &Pool) {
    // Clear only the keys this test touches, so it is safe on a shared Redis.
    let task_q = keys::retry_queue(keys::RETRY_KIND_TASK);
    for k in [
        task_q,
        keys::pipeline_counter("events_received"),
        keys::pipeline_counter("events_inserted"),
        keys::pipeline_counter("events_dropped"),
    ] {
        let _: Result<i64, _> = pool.del(k).await;
    }
}

/// One "batch" of events as the pipeline buffers them: a Vec of small JSON-able
/// rows. We use a minimal stand-in row; `push_retry_batch` is generic over
/// `Serialize`, exactly as production calls it with `TaskEventRow`.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct Row {
    task_id: String,
    state: String,
}

fn batch(n: usize, tag: &str) -> Vec<Row> {
    (0..n).map(|i| Row { task_id: format!("{tag}-{i}"), state: "RECEIVED".into() }).collect()
}

/// THE CORE FINDING.
///
/// During a *prolonged* ClickHouse outage (disk full), every insert fails and
/// every batch is pushed to the Redis retry buffer. The buffer is hard-capped
/// at `MAX_RETRY_QUEUE_LEN` batches via `LTRIM`. When it overflows, `LTRIM`
/// silently evicts the oldest batches — and the production buffering path
/// (`buffer_for_retry`) only increments `events_dropped` when the *push itself*
/// errors, never when `LTRIM` evicts.
///
/// Result: events are permanently lost, but the `events_dropped` counter — the
/// number surfaced as "Lost" on the System Health page — stays at ZERO. The
/// operator is blind to the loss. This test proves that gap with the real code.
#[tokio::test]
async fn prolonged_outage_silently_evicts_events_without_counting_them() {
    let pool = pool_or_skip!();
    reset(&pool).await;

    const EVENTS_PER_BATCH: usize = 100;
    const TOTAL_BATCHES: usize = 5_000; // far exceeds the 2_000 cap
    let cap = cache::MAX_RETRY_QUEUE_LEN as usize;

    let mut received: u64 = 0;

    // Simulate the ingest loop while ClickHouse is DOWN: each batch is received,
    // the insert fails, so we run the real buffering path.
    for b in 0..TOTAL_BATCHES {
        received += EVENTS_PER_BATCH as u64;
        cache::incr_pipeline_counter(&pool, "events_received", EVENTS_PER_BATCH as u64)
            .await
            .unwrap();

        let rows = batch(EVENTS_PER_BATCH, &format!("b{b}"));
        // This mirrors `buffer_for_retry` in pipeline.rs exactly:
        match cache::push_retry_batch(&pool, keys::RETRY_KIND_TASK, &rows).await {
            // AFTER THE FIX: push_retry_batch returns the number of events it had
            // to evict to stay under the cap, and the caller counts them as
            // dropped instead of losing them silently.
            Ok(evicted) if evicted > 0 => {
                cache::incr_pipeline_counter(&pool, "events_dropped", evicted).await.unwrap();
            }
            Ok(_) => { /* buffered for replay, nothing evicted */ }
            Err(_) => {
                cache::incr_pipeline_counter(&pool, "events_dropped", EVENTS_PER_BATCH as u64)
                    .await
                    .unwrap();
            }
        }
    }

    // ClickHouse "recovers". Drain everything that survived in the buffer.
    let mut survived_batches = 0usize;
    loop {
        let popped = cache::pop_retry_batches(&pool, keys::RETRY_KIND_TASK, 500).await.unwrap();
        if popped.is_empty() {
            break;
        }
        survived_batches += popped.len();
    }

    let survived_events = survived_batches * EVENTS_PER_BATCH;
    let actually_lost = received as usize - survived_events;

    let counters = cache::get_pipeline_counters(&pool).await.unwrap();
    let reported_dropped = *counters.get("events_dropped").unwrap_or(&0);

    println!("\n──────── ClickHouse disk-full incident reproduction ────────");
    println!("Events received during outage : {received}");
    println!("Buffer cap (batches)          : {cap}");
    println!("Batches that survived buffer  : {survived_batches}");
    println!("Events that survived          : {survived_events}");
    println!("Events ACTUALLY lost          : {actually_lost}");
    println!("Events the UI REPORTS as lost : {reported_dropped}  <-- operator sees this");
    println!("────────────────────────────────────────────────────────────\n");

    // The buffer only kept `cap` batches; the rest were evicted.
    assert_eq!(survived_batches, cap, "buffer should retain exactly the cap");
    assert!(actually_lost > 0, "a prolonged outage must have lost events");

    // AFTER THE FIX: the reported loss now matches the real loss exactly — the
    // operator is no longer blind. (Before the fix this counter stayed at 0.)
    assert_eq!(
        reported_dropped as usize, actually_lost,
        "events_dropped must equal real loss after the fix (was 0 before)"
    );
    assert_eq!(actually_lost, 300_000, "expected exactly 300k lost events");
}

/// SECONDARY FINDING: "old events in process didn't get accurate information."
///
/// A task emits its lifecycle as separate events: RECEIVED -> STARTED ->
/// SUCCESS. ClickHouse merges them at read time with `argMax(field, timestamp)`
/// (see `MERGED_TASK_SELECT` in `clickhouse/task_events.rs`). If the disk-full
/// window drops the *terminal* event but the earlier ones already landed, the
/// merged view is left permanently STARTED with no result/runtime — an
/// inaccurate, "stuck" task that never resolves.
///
/// This test models that exact argMax merge to demonstrate the outcome.
#[tokio::test]
async fn dropped_terminal_event_leaves_task_stuck_in_inaccurate_state() {
    // (timestamp, state, result, runtime) — argMax keeps the latest by timestamp.
    #[derive(Clone)]
    struct Ev {
        ts: i64,
        state: &'static str,
        result: &'static str,
        runtime: f64,
    }

    // argMax-by-timestamp merge, mirroring MERGED_TASK_SELECT.
    fn merge(events: &[Ev]) -> (&'static str, String, f64) {
        let latest = events.iter().max_by_key(|e| e.ts).unwrap();
        // argMaxIf(result, ts, result != '') — last non-empty result.
        let result = events
            .iter()
            .filter(|e| !e.result.is_empty())
            .max_by_key(|e| e.ts)
            .map(|e| e.result.to_string())
            .unwrap_or_default();
        let runtime = events.iter().map(|e| e.runtime).fold(0.0, f64::max);
        (latest.state, result, runtime)
    }

    let full = vec![
        Ev { ts: 1, state: "RECEIVED", result: "", runtime: 0.0 },
        Ev { ts: 2, state: "STARTED", result: "", runtime: 0.0 },
        Ev { ts: 3, state: "SUCCESS", result: "{\"ok\":true}", runtime: 12.5 },
    ];
    let (st, res, rt) = merge(&full);
    assert_eq!(st, "SUCCESS");
    assert_eq!(res, "{\"ok\":true}");
    assert_eq!(rt, 12.5);

    // Now the disk-full window drops the terminal SUCCESS event.
    let lossy = vec![
        Ev { ts: 1, state: "RECEIVED", result: "", runtime: 0.0 },
        Ev { ts: 2, state: "STARTED", result: "", runtime: 0.0 },
        // SUCCESS event was dropped by the disk-full outage
    ];
    let (st2, res2, rt2) = merge(&lossy);

    println!("\n──────── Inaccurate in-flight task reproduction ────────");
    println!("Healthy merge : state={st}, result={res}, runtime={rt}");
    println!("Lossy merge   : state={st2}, result={res2:?}, runtime={rt2}  <-- stuck forever");
    println!("────────────────────────────────────────────────────────\n");

    // The task is permanently, inaccurately "STARTED" with no result/runtime —
    // and nothing in the current codebase ever reconciles it.
    assert_eq!(st2, "STARTED");
    assert!(res2.is_empty());
    assert_eq!(rt2, 0.0);
}
