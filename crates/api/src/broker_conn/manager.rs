use std::sync::Arc;

use dashmap::DashMap;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::state::AppState;
use db::postgres::models::BrokerConfig;

use super::{amqp_consumer, redis_consumer};

struct BrokerConnection {
    _handle: JoinHandle<()>,
    cancel: CancellationToken,
}

/// Manages active broker connections as background Tokio tasks.
///
/// The manager does NOT store AppState internally to avoid circular references
/// during initialization. Instead, AppState is passed to each method call.
pub struct BrokerConnectionManager {
    connections: Arc<DashMap<Uuid, BrokerConnection>>,
}

impl BrokerConnectionManager {
    pub fn new() -> Self {
        Self { connections: Arc::new(DashMap::new()) }
    }

    /// Start consuming events from a broker.
    pub fn start(&self, state: &AppState, config: &BrokerConfig) {
        // Stop any existing connection for this config
        self.stop(config.id);

        let cancel = CancellationToken::new();
        let state = state.clone();
        let tenant_id = config.tenant_id;
        let config_id = config.id;
        let broker_type = config.broker_type.clone();
        let connection_url = config.connection_enc.clone();

        let cancel_clone = cancel.clone();

        let handle = tokio::spawn(async move {
            match broker_type.as_str() {
                "redis" => {
                    redis_consumer::run_redis_consumer(
                        state,
                        tenant_id,
                        config_id,
                        connection_url,
                        cancel_clone,
                    )
                    .await;
                }
                "rabbitmq" | "amqp" => {
                    amqp_consumer::run_amqp_consumer(
                        state,
                        tenant_id,
                        config_id,
                        connection_url,
                        cancel_clone,
                    )
                    .await;
                }
                other => {
                    tracing::error!(%config_id, "Unsupported broker type: {other}");
                    let _ = db::postgres::broker_configs::update_broker_config_status(
                        &state.pg,
                        config_id,
                        "error",
                        Some(&format!("Unsupported broker type: {other}")),
                    )
                    .await;
                }
            }
        });

        self.connections.insert(config_id, BrokerConnection { _handle: handle, cancel });

        tracing::info!(%config_id, %tenant_id, "Broker connection started");
    }

    /// Stop a broker connection.
    pub fn stop(&self, config_id: Uuid) {
        if let Some((_, conn)) = self.connections.remove(&config_id) {
            conn.cancel.cancel();
            tracing::info!(%config_id, "Broker connection stopped");
        }
    }

    /// Check if a broker connection is active.
    #[allow(dead_code)]
    pub fn is_running(&self, config_id: Uuid) -> bool {
        self.connections.contains_key(&config_id)
    }

    /// Test connectivity to a broker URL without starting a persistent connection.
    pub async fn test_connection(broker_type: &str, url: &str) -> Result<(), String> {
        match broker_type {
            "redis" => redis_consumer::test_redis_connection(url).await,
            "rabbitmq" | "amqp" => amqp_consumer::test_amqp_connection(url).await,
            other => Err(format!("Unsupported broker type: {other}")),
        }
    }

    /// Auto-start all active broker configs from the database.
    pub async fn auto_start_active(&self, state: &AppState) {
        match db::postgres::broker_configs::list_active_broker_configs(&state.pg).await {
            Ok(configs) => {
                let count = configs.len();
                for config in &configs {
                    self.start(state, config);
                }
                if count > 0 {
                    tracing::info!(count, "Auto-started active broker connections");
                }
            }
            Err(e) => {
                tracing::warn!(?e, "Failed to load active broker configs for auto-start");
            }
        }
    }

    /// Stop all active connections.
    #[allow(dead_code)]
    pub fn stop_all(&self) {
        let ids: Vec<Uuid> = self.connections.iter().map(|r| *r.key()).collect();
        for id in ids {
            self.stop(id);
        }
    }
}
