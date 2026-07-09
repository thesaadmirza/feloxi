use fred::prelude::*;
use serde::{de::DeserializeOwned, Serialize};
use std::time::Duration;
use uuid::Uuid;

use super::keys;

/// Set a JSON value with TTL.
pub async fn set_json<T: Serialize>(
    pool: &Pool,
    key: &str,
    value: &T,
    ttl: Duration,
) -> Result<(), Error> {
    let json =
        serde_json::to_string(value).map_err(|e| Error::new(ErrorKind::Parse, e.to_string()))?;
    pool.set::<(), _, _>(
        key,
        json.as_str(),
        Some(Expiration::EX(ttl.as_secs() as i64)),
        None,
        false,
    )
    .await?;
    Ok(())
}

/// Get a JSON value.
pub async fn get_json<T: DeserializeOwned>(pool: &Pool, key: &str) -> Result<Option<T>, Error> {
    let val: Option<String> = pool.get(key).await?;
    match val {
        Some(s) => {
            let parsed = serde_json::from_str(&s)
                .map_err(|e| Error::new(ErrorKind::Parse, e.to_string()))?;
            Ok(Some(parsed))
        }
        None => Ok(None),
    }
}

/// Update worker state in Redis.
pub async fn set_worker_state(
    pool: &Pool,
    tenant_id: Uuid,
    worker_id: &str,
    state: &impl Serialize,
) -> Result<(), Error> {
    let key = keys::worker_state(tenant_id, worker_id);
    let hb_key = keys::worker_heartbeat(tenant_id, worker_id);
    let online_key = keys::workers_online(tenant_id);

    let json =
        serde_json::to_string(state).map_err(|e| Error::new(ErrorKind::Parse, e.to_string()))?;

    // Set worker state with 2-minute TTL
    pool.set::<(), _, _>(&key, json.as_str(), Some(Expiration::EX(120)), None, false).await?;
    // Set heartbeat TTL key (90s expiry for offline detection)
    pool.set::<(), _, _>(&hb_key, "1", Some(Expiration::EX(90)), None, false).await?;
    // Add to online set
    pool.sadd::<(), _, _>(&online_key, worker_id).await?;
    // Track when any worker was last seen alive (no TTL) so the worker-offline
    // alert can measure staleness beyond the heartbeat key's expiry.
    let last_seen_key = keys::workers_last_seen(tenant_id);
    let now = common::time::to_unix_f64(&common::time::now());
    pool.set::<(), _, _>(&last_seen_key, now.to_string().as_str(), None, None, false).await?;

    Ok(())
}

/// Unix-seconds timestamp of the last worker state update for a tenant, if any
/// worker has ever been seen.
pub async fn get_workers_last_seen(pool: &Pool, tenant_id: Uuid) -> Result<Option<f64>, Error> {
    let key = keys::workers_last_seen(tenant_id);
    let val: Option<String> = pool.get(&key).await?;
    Ok(val.and_then(|v| v.parse::<f64>().ok()))
}

/// Count how many of the tenant's online-set workers still have a live
/// heartbeat key. A crashed worker never sends `worker-offline`, so it lingers
/// in the online set forever; the heartbeat TTL is the ground truth for
/// liveness. Returns (online_set_size, live_count).
pub async fn count_live_workers(pool: &Pool, tenant_id: Uuid) -> Result<(usize, usize), Error> {
    let ids = get_online_workers(pool, tenant_id).await?;
    if ids.is_empty() {
        return Ok((0, 0));
    }
    let hb_keys: Vec<String> = ids.iter().map(|w| keys::worker_heartbeat(tenant_id, w)).collect();
    let live: i64 = pool.exists(hb_keys).await?;
    Ok((ids.len(), live.max(0) as usize))
}

/// Remove worker from online set.
pub async fn set_worker_offline(
    pool: &Pool,
    tenant_id: Uuid,
    worker_id: &str,
) -> Result<(), Error> {
    let key = keys::worker_state(tenant_id, worker_id);
    let hb_key = keys::worker_heartbeat(tenant_id, worker_id);
    let online_key = keys::workers_online(tenant_id);

    pool.del::<(), _>(&key).await?;
    pool.del::<(), _>(&hb_key).await?;
    let _: i64 = pool.srem(&online_key, worker_id).await?;

    Ok(())
}

/// Cache a task state update.
pub async fn set_task_state(
    pool: &Pool,
    tenant_id: Uuid,
    task_id: &str,
    state: &impl Serialize,
    timestamp: f64,
) -> Result<(), Error> {
    let key = keys::task_state(tenant_id, task_id);
    let recent_key = keys::tasks_recent(tenant_id);

    let json =
        serde_json::to_string(state).map_err(|e| Error::new(ErrorKind::Parse, e.to_string()))?;

    // Cache task state for 1 hour
    pool.set::<(), _, _>(&key, json.as_str(), Some(Expiration::EX(3600)), None, false).await?;

    // Add to recent sorted set (score = timestamp)
    pool.zadd::<(), _, _>(&recent_key, None, None, false, false, (timestamp, task_id)).await?;

    // Trim to keep only last 10000 tasks
    pool.zremrangebyrank::<(), _>(&recent_key, 0, -10001).await?;

    Ok(())
}

/// Update queue depth.
pub async fn set_queue_depth(
    pool: &Pool,
    tenant_id: Uuid,
    queue_name: &str,
    depth: u64,
) -> Result<(), Error> {
    let key = keys::queue_depth(tenant_id, queue_name);
    let active_key = keys::queues_active(tenant_id);

    pool.set::<(), _, _>(&key, depth.to_string().as_str(), Some(Expiration::EX(120)), None, false)
        .await?;
    pool.sadd::<(), _, _>(&active_key, queue_name).await?;

    Ok(())
}

/// Get online worker IDs.
pub async fn get_online_workers(pool: &Pool, tenant_id: Uuid) -> Result<Vec<String>, Error> {
    let key = keys::workers_online(tenant_id);
    let members: Vec<String> = pool.smembers(&key).await?;
    Ok(members)
}

/// Read every cached worker state for a tenant in one round-trip via MGET.
/// Workers whose state TTL has expired are returned as `None` and the caller
/// can decide whether to discard them or keep the slot.
pub async fn get_worker_states_raw(
    pool: &Pool,
    tenant_id: Uuid,
    worker_ids: &[String],
) -> Result<Vec<Option<String>>, Error> {
    if worker_ids.is_empty() {
        return Ok(Vec::new());
    }
    let redis_keys: Vec<String> =
        worker_ids.iter().map(|w| keys::worker_state(tenant_id, w)).collect();
    let vals: Vec<Option<String>> = pool.mget(redis_keys).await?;
    Ok(vals)
}

/// Read every active queue and its current depth for a tenant. Queues whose
/// depth key has expired are skipped (the active set may carry a stale name).
pub async fn get_queue_depths(pool: &Pool, tenant_id: Uuid) -> Result<Vec<(String, u64)>, Error> {
    let active_key = keys::queues_active(tenant_id);
    let names: Vec<String> = pool.smembers(&active_key).await?;
    if names.is_empty() {
        return Ok(Vec::new());
    }
    let redis_keys: Vec<String> = names.iter().map(|n| keys::queue_depth(tenant_id, n)).collect();
    let raw: Vec<Option<String>> = pool.mget(redis_keys).await?;
    let depths = names
        .into_iter()
        .zip(raw)
        .filter_map(|(name, val)| val.and_then(|v| v.parse::<u64>().ok()).map(|d| (name, d)))
        .collect();
    Ok(depths)
}

/// Get remaining TTL of heartbeat keys for the given workers.
/// Returns (worker_id, ttl_seconds) pairs. A TTL of -2 means the key doesn't
/// exist (heartbeat expired), -1 means no expiry set.
pub async fn get_heartbeat_ttls(
    pool: &Pool,
    tenant_id: Uuid,
    worker_ids: &[String],
) -> Result<Vec<(String, i64)>, Error> {
    if worker_ids.is_empty() {
        return Ok(vec![]);
    }

    let mut results = Vec::with_capacity(worker_ids.len());
    for wid in worker_ids {
        let key = keys::worker_heartbeat(tenant_id, wid);
        let ttl: i64 = pool.ttl(&key).await?;
        results.push((wid.clone(), ttl));
    }

    Ok(results)
}

/// Check if a heartbeat sample should be stored (throttle: 1 per 30s per worker).
/// Returns true if NOT throttled (should store). Sets the throttle key on success.
pub async fn should_sample_heartbeat(
    pool: &Pool,
    tenant_id: Uuid,
    worker_id: &str,
) -> Result<bool, Error> {
    let key = keys::worker_hb_sampled(tenant_id, worker_id);
    // SET NX with 30s expiry — returns Some("OK") if newly set, None if key existed
    let result: Option<String> =
        pool.set(&key, "1", Some(Expiration::EX(30)), Some(SetOptions::NX), false).await?;
    Ok(result.is_some())
}

// ─────────────────────────── Pipeline Metrics ───────────────────────────

const PIPELINE_COUNTERS: &[&str] = &[
    "events_received",
    "events_inserted",
    "events_dropped",
    "events_parse_failed",
    "insert_retries",
];

/// Increment a pipeline counter by `delta`. Fire-and-forget safe.
pub async fn incr_pipeline_counter(pool: &Pool, name: &str, delta: u64) -> Result<u64, Error> {
    let key = keys::pipeline_counter(name);
    pool.incr_by(&key, delta as i64).await
}

/// Read all pipeline counters in a single round-trip.
pub async fn get_pipeline_counters(
    pool: &Pool,
) -> Result<std::collections::HashMap<String, u64>, Error> {
    let redis_keys: Vec<String> =
        PIPELINE_COUNTERS.iter().map(|n| keys::pipeline_counter(n)).collect();
    let vals: Vec<Option<i64>> = pool.mget(redis_keys).await?;
    let mut map = std::collections::HashMap::with_capacity(PIPELINE_COUNTERS.len());
    for (name, val) in PIPELINE_COUNTERS.iter().zip(vals) {
        map.insert((*name).to_string(), val.unwrap_or(0) as u64);
    }
    Ok(map)
}

// ─────────────────────────── Task Name Cache ───────────────────────────

/// Celery publishes task names on task-received but omits them on later
/// lifecycle events. Caching the name for an hour is plenty to stitch every
/// terminal event with the name that arrived at receive time.
const TASK_NAME_TTL_SECS: i64 = 3600;

/// Look up cached task names in one round-trip. Returns a Vec parallel to
/// `task_ids`; each element is `Some(name)` if cached, `None` otherwise.
pub async fn get_task_names(
    pool: &Pool,
    tenant_id: Uuid,
    task_ids: &[String],
) -> Result<Vec<Option<String>>, Error> {
    if task_ids.is_empty() {
        return Ok(Vec::new());
    }
    let redis_keys: Vec<String> =
        task_ids.iter().map(|tid| keys::task_name_cache(tenant_id, tid)).collect();
    let vals: Vec<Option<String>> = pool.mget(redis_keys).await?;
    Ok(vals)
}

/// Cache a set of (task_id, task_name) pairs in one pipelined round-trip.
pub async fn cache_task_names(
    pool: &Pool,
    tenant_id: Uuid,
    entries: &[(String, String)],
) -> Result<(), Error> {
    if entries.is_empty() {
        return Ok(());
    }
    let pipe = pool.next().pipeline();
    for (task_id, name) in entries {
        let key = keys::task_name_cache(tenant_id, task_id);
        let _: () = pipe
            .set(&key, name.as_str(), Some(Expiration::EX(TASK_NAME_TTL_SECS)), None, false)
            .await?;
    }
    pipe.all::<()>().await?;
    Ok(())
}

// ─────────────────────────── Retry Queues ───────────────────────────

/// With typical batches (~500 events × ~200 bytes), this caps Redis memory at
/// a few hundred MB per queue during prolonged outages.
pub const MAX_RETRY_QUEUE_LEN: i64 = 2_000;

/// Serialize a batch and enqueue it for later replay in one round-trip.
/// Cap on queued alert delivery retries; beyond this, new failures are dropped
/// (the delivery log already records the failure).
const MAX_DELIVERY_RETRY_LEN: u64 = 10_000;

/// Queue an alert delivery retry to run at `at_unix` (unix seconds).
pub async fn schedule_delivery_retry(
    pool: &Pool,
    job_json: &str,
    at_unix: f64,
) -> Result<(), Error> {
    let key = keys::alert_delivery_retry();
    let count: u64 = pool.zcard(&key).await?;
    if count >= MAX_DELIVERY_RETRY_LEN {
        return Err(Error::new(ErrorKind::Unknown, "delivery retry queue full"));
    }
    pool.zadd::<(), _, _>(&key, None, None, false, false, (at_unix, job_json)).await?;
    Ok(())
}

/// Pop delivery retries whose scheduled time has passed. Single consumer, so
/// the range-then-remove pair doesn't need to be atomic.
pub async fn pop_due_delivery_retries(
    pool: &Pool,
    now_unix: f64,
    limit: u64,
) -> Result<Vec<String>, Error> {
    let key = keys::alert_delivery_retry();
    let due: Vec<String> = pool
        .zrangebyscore(&key, f64::NEG_INFINITY, now_unix, false, Some((0, limit as i64)))
        .await?;
    if !due.is_empty() {
        pool.zrem::<(), _, _>(&key, due.clone()).await?;
    }
    Ok(due)
}

pub async fn push_retry_batch<T: Serialize + ?Sized>(
    pool: &Pool,
    kind: &str,
    batch: &T,
) -> Result<(), Error> {
    let json =
        serde_json::to_string(batch).map_err(|e| Error::new(ErrorKind::Parse, e.to_string()))?;
    let key = keys::retry_queue(kind);
    let pipe = pool.next().pipeline();
    let _: () = pipe.lpush(&key, json).await?;
    let _: () = pipe.ltrim(&key, 0, MAX_RETRY_QUEUE_LEN - 1).await?;
    pipe.all::<()>().await?;
    Ok(())
}

/// Pop up to `count` oldest buffered batches (FIFO) in a single round-trip.
pub async fn pop_retry_batches(
    pool: &Pool,
    kind: &str,
    count: usize,
) -> Result<Vec<String>, Error> {
    let key = keys::retry_queue(kind);
    let vals: Option<Vec<String>> = pool.rpop(&key, Some(count)).await?;
    Ok(vals.unwrap_or_default())
}

/// Requeue popped batches at the head so they survive the next trim and stay
/// next in line for replay. Consumes `batches` to avoid re-cloning the payload
/// on the failure path.
pub async fn requeue_retry_batches(
    pool: &Pool,
    kind: &str,
    batches: Vec<String>,
) -> Result<(), Error> {
    if batches.is_empty() {
        return Ok(());
    }
    let key = keys::retry_queue(kind);
    pool.lpush::<(), _, _>(&key, batches).await?;
    Ok(())
}

// ─────────────────────────── Alert Cooldowns ───────────────────────────

/// Check if alert rule is in cooldown.
pub async fn is_alert_in_cooldown(
    pool: &Pool,
    tenant_id: Uuid,
    rule_id: Uuid,
) -> Result<bool, Error> {
    let key = keys::alert_cooldown(tenant_id, rule_id);
    let exists: bool = pool.exists(&key).await?;
    Ok(exists)
}

/// Set alert cooldown.
pub async fn set_alert_cooldown(
    pool: &Pool,
    tenant_id: Uuid,
    rule_id: Uuid,
    cooldown_secs: u64,
) -> Result<(), Error> {
    let key = keys::alert_cooldown(tenant_id, rule_id);
    pool.set::<(), _, _>(&key, "1", Some(Expiration::EX(cooldown_secs as i64)), None, false)
        .await?;
    Ok(())
}

// ─────────────────────────── OAuth state nonces ───────────────────────────

fn oauth_nonce_key(nonce: &str) -> String {
    keys::oauth_nonce(nonce)
}

/// Record an OAuth state nonce so it can be enforced single-use on callback.
pub async fn store_oauth_nonce(pool: &Pool, nonce: &str, ttl_secs: u64) -> Result<(), Error> {
    let key = oauth_nonce_key(nonce);
    pool.set::<(), _, _>(&key, "1", Some(Expiration::EX(ttl_secs as i64)), None, false).await?;
    Ok(())
}

/// Atomically consume an OAuth state nonce. Returns true if it existed (and was
/// deleted), false if it was missing/already used — `DEL` is atomic, so a
/// replayed callback within the TTL fails.
pub async fn consume_oauth_nonce(pool: &Pool, nonce: &str) -> Result<bool, Error> {
    let key = oauth_nonce_key(nonce);
    let deleted: i64 = pool.del(&key).await?;
    Ok(deleted == 1)
}

// ─────────────────────── Slack channel list cache ───────────────────────

/// Redis key for an integration's cached Slack channel list.
pub fn slack_channels_key(integration_id: Uuid) -> String {
    keys::slack_channels(integration_id)
}

/// Drop a cached channel list (call on integration delete/revoke so a stale
/// list isn't served after the connection changes).
pub async fn clear_slack_channels(pool: &Pool, integration_id: Uuid) -> Result<(), Error> {
    let _: i64 = pool.del(&slack_channels_key(integration_id)).await?;
    Ok(())
}

/// Redis key for the single-flight lock guarding channel enumeration.
fn slack_channels_lock_key(integration_id: Uuid) -> String {
    format!("{}:lock", slack_channels_key(integration_id))
}

/// Try to become the sole enumerator of an integration's channel list. Returns
/// true if the lock was acquired (this caller should enumerate and populate the
/// cache), false if another request already holds it. `conversations.list` is a
/// Tier-2 Slack endpoint (~20 req/min), so collapsing concurrent enumerations
/// keeps a burst of searches from tripping the rate limit. The lock auto-expires
/// so a crashed holder can't wedge the picker.
pub async fn try_lock_slack_channels(
    pool: &Pool,
    integration_id: Uuid,
    ttl_secs: u64,
) -> Result<bool, Error> {
    let key = slack_channels_lock_key(integration_id);
    let result: Option<String> = pool
        .set(&key, "1", Some(Expiration::EX(ttl_secs as i64)), Some(SetOptions::NX), false)
        .await?;
    Ok(result.is_some())
}

/// Release the channel-enumeration lock (best-effort; it also auto-expires).
pub async fn unlock_slack_channels(pool: &Pool, integration_id: Uuid) -> Result<(), Error> {
    let _: i64 = pool.del(&slack_channels_lock_key(integration_id)).await?;
    Ok(())
}
