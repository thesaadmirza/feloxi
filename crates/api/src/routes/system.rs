use std::time::Duration;

use axum::{extract::State, routing::get, Extension, Json, Router};
use fred::prelude::*;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::state::AppState;
use auth::middleware::CurrentUser;
use common::AppError;
use db::clickhouse::system::{DeadLetterRow, DeadLetterSummary, TableStorageRow};

// ─────────────────────────── Response Types ───────────────────────────

#[derive(Serialize, Deserialize, ToSchema)]
pub struct PipelineStatsResponse {
    pub events_received: u64,
    pub events_inserted: u64,
    pub events_dropped: u64,
    pub events_parse_failed: u64,
    pub insert_retries: u64,
    pub drop_rate: f64,
    pub success_rate: f64,
}

#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct ComponentHealth {
    pub name: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct StorageInfo {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub free_bytes: u64,
    pub tables: Vec<TableStorageRow>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct SystemHealthResponse {
    pub status: String,
    pub version: String,
    pub components: Vec<ComponentHealth>,
    pub pipeline: PipelineStatsResponse,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage: Option<StorageInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dead_letters: Option<DeadLetterSummary>,
}

#[derive(Serialize, ToSchema)]
pub struct DeadLetterListResponse {
    pub data: Vec<DeadLetterRow>,
}

// ─────────────────────────── Handlers ───────────────────────────

/// Get pipeline ingestion metrics (from Redis counters).
#[utoipa::path(
    get,
    path = "/api/v1/system/pipeline",
    tag = "system",
    responses(
        (status = 200, description = "Pipeline stats", body = PipelineStatsResponse)
    )
)]
pub async fn pipeline_stats(
    State(state): State<AppState>,
) -> Result<Json<PipelineStatsResponse>, AppError> {
    let counters = db::redis::cache::get_pipeline_counters(&state.redis)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let received = *counters.get("events_received").unwrap_or(&0);
    let inserted = *counters.get("events_inserted").unwrap_or(&0);
    let dropped = *counters.get("events_dropped").unwrap_or(&0);

    let drop_rate = if received > 0 { dropped as f64 / received as f64 } else { 0.0 };
    let success_rate = if received > 0 { inserted as f64 / received as f64 } else { 1.0 };

    Ok(Json(PipelineStatsResponse {
        events_received: received,
        events_inserted: inserted,
        events_dropped: dropped,
        events_parse_failed: *counters.get("events_parse_failed").unwrap_or(&0),
        insert_retries: *counters.get("insert_retries").unwrap_or(&0),
        drop_rate,
        success_rate,
    }))
}

/// Get full system health: component statuses, pipeline metrics, storage info.
#[utoipa::path(
    get,
    path = "/api/v1/system/health",
    tag = "system",
    responses(
        (status = 200, description = "System health", body = SystemHealthResponse)
    )
)]
pub async fn system_health(
    State(state): State<AppState>,
) -> Result<Json<SystemHealthResponse>, AppError> {
    // Check cache first
    if let Some(cached) = state.health_cache.get().await {
        let resp: SystemHealthResponse =
            serde_json::from_value(cached).map_err(|e| AppError::Internal(e.to_string()))?;
        return Ok(Json(resp));
    }

    let mut components = Vec::new();

    // PostgreSQL health
    let pg_health = check_component("postgresql", async {
        sqlx::query("SELECT 1").execute(&state.pg).await.map(|_| ()).map_err(|e| e.to_string())
    })
    .await;
    components.push(pg_health);

    // ClickHouse health
    let ch_health = check_component("clickhouse", async {
        db::clickhouse::system::ping(&state.ch).await.map_err(|e| e.to_string())
    })
    .await;
    components.push(ch_health);

    // Redis health
    let redis_pool = state.redis.clone();
    let redis_health = check_component("redis", async move {
        let _: String = redis_pool.ping(None).await.map_err(|e| e.to_string())?;
        Ok(())
    })
    .await;
    components.push(redis_health);

    // Broker statuses from PostgreSQL (all active configs across tenants)
    if let Ok(broker_configs) = sqlx::query_as::<_, db::postgres::models::BrokerConfig>(
        "SELECT * FROM broker_configs WHERE is_active = true",
    )
    .fetch_all(&state.pg)
    .await
    {
        for cfg in &broker_configs {
            components.push(ComponentHealth {
                name: format!("broker:{}", cfg.name),
                status: if cfg.status == "connected" {
                    "up".to_string()
                } else {
                    "down".to_string()
                },
                latency_ms: None,
                message: cfg.last_error.clone(),
            });
        }
    }

    // Pipeline stats
    let pipeline = build_pipeline_stats(&state).await;

    // ClickHouse storage (best-effort)
    let storage = build_storage_info(&state).await;

    // Dead-letter summary (best-effort, use nil tenant for global)
    let dead_letters = None; // Will be populated per-tenant in protected endpoint

    // Determine overall status
    let ch_up =
        components.iter().find(|c| c.name == "clickhouse").is_some_and(|c| c.status == "up");
    let pg_up =
        components.iter().find(|c| c.name == "postgresql").is_some_and(|c| c.status == "up");
    let all_up = components.iter().all(|c| c.status == "up");

    // events_dropped is a monotonic counter; with the retry buffer in place a
    // brief CH outage no longer increments it, so we treat the dependency
    // status as the only auto-degrade signal. The dropped count is still
    // surfaced on the system page for operators who care.
    let status = if !pg_up || !ch_up {
        "unhealthy"
    } else if !all_up {
        "degraded"
    } else {
        "healthy"
    }
    .to_string();

    let resp = SystemHealthResponse {
        status,
        version: env!("CARGO_PKG_VERSION").to_string(),
        components,
        pipeline,
        storage,
        dead_letters,
    };

    // Cache the response
    if let Ok(json) = serde_json::to_value(&resp) {
        state.health_cache.set(json).await;
    }

    Ok(Json(resp))
}

/// Get recent dead-letter entries for the authenticated tenant.
#[utoipa::path(
    get,
    path = "/api/v1/system/dead-letters",
    tag = "system",
    responses(
        (status = 200, description = "Dead letter entries", body = DeadLetterListResponse)
    )
)]
pub async fn dead_letters(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<DeadLetterListResponse>, AppError> {
    let entries = db::clickhouse::system::get_dead_letters(&state.ch, user.tenant_id, 100).await?;
    Ok(Json(DeadLetterListResponse { data: entries }))
}

// ─────────────────────────── Helpers ───────────────────────────

async fn check_component<F>(name: &str, check: F) -> ComponentHealth
where
    F: std::future::Future<Output = Result<(), String>>,
{
    let start = tokio::time::Instant::now();
    let result = tokio::time::timeout(Duration::from_secs(2), check).await;

    match result {
        Ok(Ok(())) => ComponentHealth {
            name: name.to_string(),
            status: "up".to_string(),
            latency_ms: Some(start.elapsed().as_millis() as u64),
            message: None,
        },
        Ok(Err(e)) => ComponentHealth {
            name: name.to_string(),
            status: "down".to_string(),
            latency_ms: Some(start.elapsed().as_millis() as u64),
            message: Some(e),
        },
        Err(_) => ComponentHealth {
            name: name.to_string(),
            status: "down".to_string(),
            latency_ms: Some(2000),
            message: Some("Health check timed out".to_string()),
        },
    }
}

async fn build_pipeline_stats(state: &AppState) -> PipelineStatsResponse {
    let counters = db::redis::cache::get_pipeline_counters(&state.redis).await.unwrap_or_default();

    let received = *counters.get("events_received").unwrap_or(&0);
    let inserted = *counters.get("events_inserted").unwrap_or(&0);
    let dropped = *counters.get("events_dropped").unwrap_or(&0);

    PipelineStatsResponse {
        events_received: received,
        events_inserted: inserted,
        events_dropped: dropped,
        events_parse_failed: *counters.get("events_parse_failed").unwrap_or(&0),
        insert_retries: *counters.get("insert_retries").unwrap_or(&0),
        drop_rate: if received > 0 { dropped as f64 / received as f64 } else { 0.0 },
        success_rate: if received > 0 { inserted as f64 / received as f64 } else { 1.0 },
    }
}

async fn build_storage_info(state: &AppState) -> Option<StorageInfo> {
    let disk = db::clickhouse::system::get_disk_usage(&state.ch).await.ok().flatten()?;
    let tables = db::clickhouse::system::get_table_storage(&state.ch).await.unwrap_or_default();

    Some(StorageInfo {
        total_bytes: disk.total_space,
        used_bytes: disk.total_space.saturating_sub(disk.free_space),
        free_bytes: disk.free_space,
        tables,
    })
}

// ─────────────────────────── Router ───────────────────────────

/// Public system routes (no auth).
pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/system/pipeline", get(pipeline_stats))
        .route("/system/health", get(system_health))
}

/// Protected system routes (auth required).
pub fn protected_router() -> Router<AppState> {
    Router::new().route("/system/dead-letters", get(dead_letters))
}
