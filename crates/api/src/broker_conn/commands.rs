//! Broker command execution.
//!
//! Publishes Celery tasks (retry) and broadcasts control commands (revoke, shutdown)
//! directly to the broker.

use fred::prelude::*;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

/// Queue depth information.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct QueueInfo {
    pub queue_name: String,
    pub depth: u64,
}

// ─── Redis Commands ──────────────────────────────────────────────────────────

/// Publish a new task to a Redis broker queue using the Kombu envelope format.
pub async fn redis_publish_task(
    connection_url: &str,
    task_name: &str,
    task_id: &str,
    args: &serde_json::Value,
    kwargs: &serde_json::Value,
    queue: &str,
    parent_id: Option<&str>,
    root_id: Option<&str>,
) -> Result<(), String> {
    let client = connect_redis(connection_url).await?;

    let effective_root = root_id.unwrap_or(task_id);

    let body = serde_json::json!([
        args,
        kwargs,
        {"callbacks": null, "errbacks": null, "chain": null, "chord": null}
    ]);
    let body_str = serde_json::to_string(&body).map_err(|e| e.to_string())?;

    let envelope = serde_json::json!({
        "body": body_str,
        "content-encoding": "utf-8",
        "content-type": "application/json",
        "headers": {
            "lang": "py",
            "task": task_name,
            "id": task_id,
            "root_id": effective_root,
            "parent_id": parent_id,
            "group": null,
            "origin": "feloxi",
            "argsrepr": serde_json::to_string(args).unwrap_or_default(),
            "kwargsrepr": serde_json::to_string(kwargs).unwrap_or_default(),
        },
        "properties": {
            "correlation_id": task_id,
            "reply_to": "",
            "delivery_mode": 2,
            "delivery_info": {
                "exchange": "",
                "routing_key": queue,
            },
            "priority": 0,
            "body_encoding": "base64",
            "delivery_tag": Uuid::new_v4().to_string(),
        }
    });

    let msg = serde_json::to_string(&envelope).map_err(|e| e.to_string())?;
    client
        .lpush::<(), _, _>(queue, msg.as_str())
        .await
        .map_err(|e| format!("Failed to LPUSH task: {e}"))?;

    Ok(())
}

/// Broadcast a Celery remote control command via Redis PUBLISH to the pidbox.
async fn redis_broadcast_control(
    connection_url: &str,
    method: &str,
    arguments: serde_json::Value,
    destination: Option<&[&str]>,
) -> Result<(), String> {
    let client = connect_redis(connection_url).await?;

    // Parse DB number from URL for the pidbox channel
    let db = parse_redis_db(connection_url);
    let channel = format!("/{db}/celery.pidbox");

    let control_msg = serde_json::json!({
        "method": method,
        "arguments": arguments,
        "destination": destination,
        "pattern": null,
        "matcher": null,
    });

    let msg = serde_json::to_string(&control_msg).map_err(|e| e.to_string())?;
    client
        .publish::<(), _, _>(channel.as_str(), msg.as_str())
        .await
        .map_err(|e| format!("Failed to PUBLISH control command: {e}"))?;

    Ok(())
}

/// Revoke a task via Redis pidbox broadcast.
pub async fn redis_revoke_task(
    connection_url: &str,
    task_id: &str,
    terminate: bool,
) -> Result<(), String> {
    let signal = if terminate { "SIGTERM" } else { "SIGQUIT" };
    redis_broadcast_control(
        connection_url,
        "revoke",
        serde_json::json!({
            "task_id": task_id,
            "terminate": terminate,
            "signal": signal,
        }),
        None,
    )
    .await
}

/// Shutdown a worker via Redis pidbox broadcast.
pub async fn redis_shutdown_worker(connection_url: &str, hostname: &str) -> Result<(), String> {
    redis_broadcast_control(connection_url, "shutdown", serde_json::json!({}), Some(&[hostname]))
        .await
}

/// Get queue depths from a Redis broker.
pub async fn redis_queue_stats(connection_url: &str) -> Result<Vec<QueueInfo>, String> {
    let client = connect_redis(connection_url).await?;

    // Read queue names from Kombu binding set
    let binding_key = "_kombu.binding.celery";
    let members: Vec<String> = client.smembers(binding_key).await.unwrap_or_default();

    let mut queue_names: Vec<String> = members
        .iter()
        .filter_map(|m| {
            let name = m.split('\t').next()?;
            if name.is_empty() {
                None
            } else {
                Some(name.to_string())
            }
        })
        .collect();

    queue_names.sort();
    queue_names.dedup();

    // Also check for default "celery" queue
    if !queue_names.contains(&"celery".to_string()) {
        queue_names.push("celery".to_string());
    }

    let mut stats = Vec::new();
    for name in &queue_names {
        let depth: u64 = client.llen(name.as_str()).await.unwrap_or(0);
        stats.push(QueueInfo { queue_name: name.clone(), depth });
    }

    Ok(stats)
}

// ─── AMQP Commands ───────────────────────────────────────────────────────────

/// Publish a new task to an AMQP broker queue.
pub async fn amqp_publish_task(
    connection_url: &str,
    task_name: &str,
    task_id: &str,
    args: &serde_json::Value,
    kwargs: &serde_json::Value,
    queue: &str,
    parent_id: Option<&str>,
    root_id: Option<&str>,
) -> Result<(), String> {
    let conn = connect_amqp(connection_url).await?;
    let channel =
        conn.create_channel().await.map_err(|e| format!("Failed to create AMQP channel: {e}"))?;

    let body = serde_json::json!([
        args,
        kwargs,
        {"callbacks": null, "errbacks": null, "chain": null, "chord": null}
    ]);
    let payload = serde_json::to_vec(&body).map_err(|e| e.to_string())?;

    let properties = lapin::BasicProperties::default()
        .with_correlation_id(task_id.into())
        .with_content_type("application/json".into())
        .with_content_encoding("utf-8".into())
        .with_delivery_mode(2) // persistent
        .with_headers({
            let mut headers = lapin::types::FieldTable::default();
            headers.insert("task".into(), lapin::types::AMQPValue::LongString(task_name.into()));
            headers.insert("id".into(), lapin::types::AMQPValue::LongString(task_id.into()));
            headers.insert(
                "root_id".into(),
                lapin::types::AMQPValue::LongString(root_id.unwrap_or(task_id).into()),
            );
            if let Some(pid) = parent_id {
                headers.insert("parent_id".into(), lapin::types::AMQPValue::LongString(pid.into()));
            }
            headers.insert("lang".into(), lapin::types::AMQPValue::LongString("py".into()));
            headers.insert("origin".into(), lapin::types::AMQPValue::LongString("feloxi".into()));
            headers
        });

    channel
        .basic_publish(
            "", // default exchange
            queue,
            lapin::options::BasicPublishOptions::default(),
            &payload,
            properties,
        )
        .await
        .map_err(|e| format!("Failed to publish task: {e}"))?
        .await
        .map_err(|e| format!("Publisher confirm failed: {e}"))?;

    let _ = channel.close(200, "done").await;
    let _ = conn.close(200, "done").await;

    Ok(())
}

/// Broadcast a Celery remote control command via AMQP fanout exchange (pidbox).
async fn amqp_broadcast_control(
    connection_url: &str,
    method: &str,
    arguments: serde_json::Value,
    destination: Option<&[&str]>,
) -> Result<(), String> {
    let conn = connect_amqp(connection_url).await?;
    let channel =
        conn.create_channel().await.map_err(|e| format!("Failed to create AMQP channel: {e}"))?;

    // Declare the pidbox fanout exchange
    channel
        .exchange_declare(
            "celery.pidbox",
            lapin::ExchangeKind::Fanout,
            lapin::options::ExchangeDeclareOptions::default(),
            lapin::types::FieldTable::default(),
        )
        .await
        .map_err(|e| format!("Failed to declare pidbox exchange: {e}"))?;

    let control_msg = serde_json::json!({
        "method": method,
        "arguments": arguments,
        "destination": destination,
        "pattern": null,
        "matcher": null,
    });

    let payload = serde_json::to_vec(&control_msg).map_err(|e| e.to_string())?;

    channel
        .basic_publish(
            "celery.pidbox",
            "",
            lapin::options::BasicPublishOptions::default(),
            &payload,
            lapin::BasicProperties::default().with_content_type("application/json".into()),
        )
        .await
        .map_err(|e| format!("Failed to publish control command: {e}"))?;

    let _ = channel.close(200, "done").await;
    let _ = conn.close(200, "done").await;

    Ok(())
}

/// Revoke a task via AMQP pidbox broadcast.
pub async fn amqp_revoke_task(
    connection_url: &str,
    task_id: &str,
    terminate: bool,
) -> Result<(), String> {
    let signal = if terminate { "SIGTERM" } else { "SIGQUIT" };
    amqp_broadcast_control(
        connection_url,
        "revoke",
        serde_json::json!({
            "task_id": task_id,
            "terminate": terminate,
            "signal": signal,
        }),
        None,
    )
    .await
}

/// Shutdown a worker via AMQP pidbox broadcast.
pub async fn amqp_shutdown_worker(connection_url: &str, hostname: &str) -> Result<(), String> {
    amqp_broadcast_control(connection_url, "shutdown", serde_json::json!({}), Some(&[hostname]))
        .await
}

// ─── Unified API ─────────────────────────────────────────────────────────────

/// Publish a task to the correct broker based on type.
pub async fn publish_task(
    broker_type: &str,
    connection_url: &str,
    task_name: &str,
    task_id: &str,
    args: &serde_json::Value,
    kwargs: &serde_json::Value,
    queue: &str,
    parent_id: Option<&str>,
    root_id: Option<&str>,
) -> Result<(), String> {
    match broker_type {
        "redis" => {
            redis_publish_task(
                connection_url,
                task_name,
                task_id,
                args,
                kwargs,
                queue,
                parent_id,
                root_id,
            )
            .await
        }
        "rabbitmq" | "amqp" => {
            amqp_publish_task(
                connection_url,
                task_name,
                task_id,
                args,
                kwargs,
                queue,
                parent_id,
                root_id,
            )
            .await
        }
        other => Err(format!("Unsupported broker type: {other}")),
    }
}

/// Revoke a task via the correct broker.
pub async fn revoke_task(
    broker_type: &str,
    connection_url: &str,
    task_id: &str,
    terminate: bool,
) -> Result<(), String> {
    match broker_type {
        "redis" => redis_revoke_task(connection_url, task_id, terminate).await,
        "rabbitmq" | "amqp" => amqp_revoke_task(connection_url, task_id, terminate).await,
        other => Err(format!("Unsupported broker type: {other}")),
    }
}

/// Shutdown a worker via the correct broker.
pub async fn shutdown_worker(
    broker_type: &str,
    connection_url: &str,
    hostname: &str,
) -> Result<(), String> {
    match broker_type {
        "redis" => redis_shutdown_worker(connection_url, hostname).await,
        "rabbitmq" | "amqp" => amqp_shutdown_worker(connection_url, hostname).await,
        other => Err(format!("Unsupported broker type: {other}")),
    }
}

/// Get queue stats from the correct broker.
pub async fn queue_stats(
    broker_type: &str,
    connection_url: &str,
) -> Result<Vec<QueueInfo>, String> {
    match broker_type {
        "redis" => redis_queue_stats(connection_url).await,
        "rabbitmq" | "amqp" => {
            // AMQP queue stats require the management plugin API (port 15672)
            // which is not always available. Return empty for now.
            Ok(vec![])
        }
        other => Err(format!("Unsupported broker type: {other}")),
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async fn connect_redis(url: &str) -> Result<Client, String> {
    let config = Config::from_url(url).map_err(|e| format!("Invalid Redis URL: {e}"))?;
    let mut builder = Builder::from_config(config);
    builder.set_policy(ReconnectPolicy::new_constant(0, 3000));
    let client = builder.build().map_err(|e| format!("Failed to build Redis client: {e}"))?;

    tokio::time::timeout(std::time::Duration::from_secs(5), client.init())
        .await
        .map_err(|_| "Redis connection timed out".to_string())?
        .map_err(|e| format!("Failed to connect to Redis: {e}"))?;

    Ok(client)
}

async fn connect_amqp(url: &str) -> Result<lapin::Connection, String> {
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        lapin::Connection::connect(url, lapin::ConnectionProperties::default()),
    )
    .await
    .map_err(|_| "AMQP connection timed out".to_string())?
    .map_err(|e| format!("Failed to connect to AMQP: {e}"))
}

pub(crate) fn parse_redis_db(url: &str) -> u32 {
    url.rsplit('/')
        .next()
        .map(|s| s.split('?').next().unwrap_or(s))
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_redis_db_default() {
        assert_eq!(parse_redis_db("redis://localhost:6379"), 0);
    }

    #[test]
    fn parse_redis_db_explicit() {
        assert_eq!(parse_redis_db("redis://localhost:6379/1"), 1);
        assert_eq!(parse_redis_db("redis://localhost:6379/15"), 15);
    }

    #[test]
    fn parse_redis_db_with_params() {
        // When there's a query string, the "db" portion won't parse as u8
        assert_eq!(parse_redis_db("redis://localhost:6379/0?timeout=5"), 0);
    }
}
