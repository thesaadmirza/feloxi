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

    Ok(())
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
