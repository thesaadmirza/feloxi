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
