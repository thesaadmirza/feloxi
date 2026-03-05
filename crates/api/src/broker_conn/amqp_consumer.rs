use std::time::Duration;

use futures::StreamExt;
use lapin::{options::*, types::FieldTable, Channel, Connection, ConnectionProperties, Consumer};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::pipeline;
use crate::state::AppState;

/// Consume Celery events from a RabbitMQ broker via AMQP.
///
/// Celery workers publish events to the `celeryev` fanout exchange. We declare
/// an exclusive auto-delete queue, bind it to the exchange, and consume.
pub async fn run_amqp_consumer(
    state: AppState,
    tenant_id: Uuid,
    config_id: Uuid,
    broker_url: String,
    cancel: CancellationToken,
) {
    tracing::info!(%tenant_id, %config_id, "Starting AMQP broker consumer");

    let conn = match connect_with_retry(&broker_url, 3).await {
        Ok(c) => c,
        Err(e) => {
            let err = format!("Failed to connect to AMQP broker: {e}");
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

    let channel = match conn.create_channel().await {
        Ok(ch) => ch,
        Err(e) => {
            let err = format!("Failed to create AMQP channel: {e}");
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

    let consumer = match setup_celery_consumer(&channel).await {
        Ok(c) => c,
        Err(e) => {
            let err = format!("Failed to set up Celery event consumer: {e}");
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

    // Mark as connected
    let _ = db::postgres::broker_configs::update_broker_config_status(
        &state.pg,
        config_id,
        "connected",
        None,
    )
    .await;

    tracing::info!(%config_id, "Connected to AMQP broker, consuming celeryev events");

    consume_loop(state.clone(), tenant_id, config_id, consumer, cancel).await;

    let _ = db::postgres::broker_configs::update_broker_config_status(
        &state.pg,
        config_id,
        "disconnected",
        None,
    )
    .await;

    let _ = channel.close(200, "shutdown").await;
    let _ = conn.close(200, "shutdown").await;
}

async fn connect_with_retry(url: &str, max_retries: u32) -> Result<Connection, String> {
    let mut attempt = 0;
    loop {
        match Connection::connect(url, ConnectionProperties::default()).await {
            Ok(conn) => return Ok(conn),
            Err(e) => {
                attempt += 1;
                if attempt >= max_retries {
                    return Err(format!("{e}"));
                }
                tracing::warn!(attempt, max_retries, "AMQP connection failed, retrying...");
                tokio::time::sleep(Duration::from_secs(2_u64.pow(attempt))).await;
            }
        }
    }
}

async fn setup_celery_consumer(channel: &Channel) -> Result<Consumer, lapin::Error> {
    // Declare the celeryev exchange (fanout, durable — Celery creates this)
    channel
        .exchange_declare(
            "celeryev",
            lapin::ExchangeKind::Fanout,
            ExchangeDeclareOptions { durable: true, ..Default::default() },
            FieldTable::default(),
        )
        .await?;

    // Declare an exclusive auto-delete queue for this consumer
    let queue = channel
        .queue_declare(
            "",
            QueueDeclareOptions { exclusive: true, auto_delete: true, ..Default::default() },
            FieldTable::default(),
        )
        .await?;

    let queue_name = queue.name().as_str();

    // Bind to the celeryev exchange
    channel
        .queue_bind(queue_name, "celeryev", "#", QueueBindOptions::default(), FieldTable::default())
        .await?;

    // Start consuming
    channel
        .basic_consume(
            queue_name,
            "feloxi-monitor",
            BasicConsumeOptions { no_ack: true, ..Default::default() },
            FieldTable::default(),
        )
        .await
}

async fn consume_loop(
    state: AppState,
    tenant_id: Uuid,
    config_id: Uuid,
    mut consumer: Consumer,
    cancel: CancellationToken,
) {
    let mut task_batch = Vec::with_capacity(100);
    let mut worker_batch = Vec::with_capacity(20);
    let mut flush_interval = tokio::time::interval(Duration::from_secs(1));

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                tracing::info!(%config_id, "AMQP consumer shutting down");
                break;
            }
            _ = flush_interval.tick() => {
                if !task_batch.is_empty() {
                    let events = std::mem::take(&mut task_batch);
                    pipeline::ingest_raw_task_events(
                        &state, tenant_id, config_id, "celery", events,
                    ).await;
                }
                if !worker_batch.is_empty() {
                    let events = std::mem::take(&mut worker_batch);
                    pipeline::ingest_raw_worker_events(
                        &state, tenant_id, config_id, events,
                    ).await;
                }
            }
            delivery = consumer.next() => {
                match delivery {
                    Some(Ok(delivery)) => {
                        let body_str = match std::str::from_utf8(&delivery.data) {
                            Ok(s) => s,
                            Err(_) => continue,
                        };

                        // Parse the event
                        let body: serde_json::Value = match serde_json::from_str(body_str) {
                            Ok(v) => v,
                            Err(_) => continue,
                        };

                        let event_type = body
                            .get("type")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown")
                            .to_string();

                        if event_type.starts_with("task-") {
                            if let Some(raw_event) = common::parse_celery_event(&event_type, &body) {
                                task_batch.push(raw_event);
                                if task_batch.len() >= 100 {
                                    let events = std::mem::take(&mut task_batch);
                                    pipeline::ingest_raw_task_events(
                                        &state, tenant_id, config_id, "celery", events,
                                    ).await;
                                }
                            }
                        } else if event_type.starts_with("worker-") {
                            if let Some(raw_event) = common::parse_celery_worker_event(&event_type, &body) {
                                worker_batch.push(raw_event);
                                if worker_batch.len() >= 20 {
                                    let events = std::mem::take(&mut worker_batch);
                                    pipeline::ingest_raw_worker_events(
                                        &state, tenant_id, config_id, events,
                                    ).await;
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        tracing::error!(%config_id, ?e, "AMQP delivery error");
                        break;
                    }
                    None => {
                        tracing::warn!(%config_id, "AMQP consumer stream ended");
                        break;
                    }
                }
            }
        }
    }

    // Flush remaining
    if !task_batch.is_empty() {
        pipeline::ingest_raw_task_events(&state, tenant_id, config_id, "celery", task_batch).await;
    }
    if !worker_batch.is_empty() {
        pipeline::ingest_raw_worker_events(&state, tenant_id, config_id, worker_batch).await;
    }
}

/// Test connectivity to an AMQP broker URL.
pub async fn test_amqp_connection(url: &str) -> Result<(), String> {
    let conn = tokio::time::timeout(
        Duration::from_secs(5),
        Connection::connect(url, ConnectionProperties::default()),
    )
    .await
    .map_err(|_| "Connection timed out after 5 seconds".to_string())?
    .map_err(|e| format!("Failed to connect: {e}"))?;

    let _ = conn.close(200, "test complete").await;
    Ok(())
}
