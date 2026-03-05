use axum::{
    extract::{Path, State},
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::routes::responses::{
    BrokerListResponse, QueueListResponse, StringListResponse, TestConnectionResponse,
};
use crate::state::AppState;
use auth::middleware::CurrentUser;
use common::AppError;

// ─── Request types ─────────────────────────────────────────────

#[derive(Deserialize, ToSchema)]
pub struct CreateBrokerRequest {
    pub name: String,
    pub broker_type: String,
    pub connection_url: String,
}

#[derive(Deserialize, ToSchema)]
pub struct TestConnectionRequest {
    pub broker_type: String,
    pub connection_url: String,
}

// ─── Broker config handlers ────────────────────────────────────

#[utoipa::path(
    get,
    path = "/api/v1/brokers",
    tag = "brokers",
    responses((status = 200, description = "Success", body = BrokerListResponse))
)]
pub async fn list_brokers(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<BrokerListResponse>, AppError> {
    auth::rbac::check_permission(&user, "brokers_manage")?;
    let configs =
        db::postgres::broker_configs::list_broker_configs(&state.pg, user.tenant_id).await?;
    Ok(Json(BrokerListResponse { data: configs }))
}

#[utoipa::path(
    post,
    path = "/api/v1/brokers",
    tag = "brokers",
    request_body = CreateBrokerRequest,
    responses((status = 200, description = "Success", body = db::postgres::models::BrokerConfig))
)]
pub async fn create_broker(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Json(req): Json<CreateBrokerRequest>,
) -> Result<Json<db::postgres::models::BrokerConfig>, AppError> {
    auth::rbac::check_permission(&user, "brokers_manage")?;

    let input = db::postgres::models::CreateBrokerConfig {
        tenant_id: user.tenant_id,
        name: req.name,
        broker_type: req.broker_type,
        connection_enc: req.connection_url,
    };

    let config = db::postgres::broker_configs::create_broker_config(&state.pg, &input).await?;

    // Auto-start the connection
    state.broker_manager.start(&state, &config);

    Ok(Json(config))
}

#[utoipa::path(
    get,
    path = "/api/v1/brokers/{id}",
    tag = "brokers",
    params(("id" = Uuid, Path, description = "Broker ID")),
    responses((status = 200, description = "Success", body = db::postgres::models::BrokerConfig))
)]
pub async fn get_broker(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<db::postgres::models::BrokerConfig>, AppError> {
    auth::rbac::check_permission(&user, "brokers_manage")?;
    let config =
        db::postgres::broker_configs::get_broker_config(&state.pg, id, user.tenant_id).await?;
    Ok(Json(config))
}

#[utoipa::path(
    delete,
    path = "/api/v1/brokers/{id}",
    tag = "brokers",
    params(("id" = Uuid, Path, description = "Broker ID")),
    responses((status = 200, description = "Success", body = serde_json::Value))
)]
pub async fn delete_broker(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth::rbac::check_permission(&user, "brokers_manage")?;

    // Stop the connection first
    state.broker_manager.stop(id);

    db::postgres::broker_configs::delete_broker_config(&state.pg, id, user.tenant_id).await?;

    Ok(Json(serde_json::json!({ "deleted": true })))
}

#[utoipa::path(
    post,
    path = "/api/v1/brokers/{id}/start",
    tag = "brokers",
    params(("id" = Uuid, Path, description = "Broker ID")),
    responses((status = 200, description = "Success", body = serde_json::Value))
)]
pub async fn start_broker(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth::rbac::check_permission(&user, "brokers_manage")?;

    let config =
        db::postgres::broker_configs::get_broker_config(&state.pg, id, user.tenant_id).await?;

    db::postgres::broker_configs::set_broker_active(&state.pg, id, user.tenant_id, true).await?;
    state.broker_manager.start(&state, &config);

    Ok(Json(serde_json::json!({ "started": true })))
}

#[utoipa::path(
    post,
    path = "/api/v1/brokers/{id}/stop",
    tag = "brokers",
    params(("id" = Uuid, Path, description = "Broker ID")),
    responses((status = 200, description = "Success", body = serde_json::Value))
)]
pub async fn stop_broker(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth::rbac::check_permission(&user, "brokers_manage")?;

    // Verify the config exists and belongs to tenant
    let _config =
        db::postgres::broker_configs::get_broker_config(&state.pg, id, user.tenant_id).await?;

    db::postgres::broker_configs::set_broker_active(&state.pg, id, user.tenant_id, false).await?;
    state.broker_manager.stop(id);

    db::postgres::broker_configs::update_broker_config_status(&state.pg, id, "disconnected", None)
        .await?;

    Ok(Json(serde_json::json!({ "stopped": true })))
}

#[utoipa::path(
    post,
    path = "/api/v1/brokers/test",
    tag = "brokers",
    request_body = TestConnectionRequest,
    responses((status = 200, description = "Success", body = TestConnectionResponse))
)]
pub async fn test_connection(
    State(_state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Json(req): Json<TestConnectionRequest>,
) -> Result<Json<TestConnectionResponse>, AppError> {
    auth::rbac::check_permission(&user, "brokers_manage")?;

    use crate::broker_conn::manager::BrokerConnectionManager;

    match BrokerConnectionManager::test_connection(&req.broker_type, &req.connection_url).await {
        Ok(()) => Ok(Json(TestConnectionResponse { success: true, error: None })),
        Err(err) => Ok(Json(TestConnectionResponse { success: false, error: Some(err) })),
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/brokers/{id}/stats",
    tag = "brokers",
    params(("id" = Uuid, Path, description = "Broker ID")),
    responses((status = 200, description = "Success", body = db::clickhouse::aggregations::BrokerStats))
)]
pub async fn get_broker_stats(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<db::clickhouse::aggregations::BrokerStats>, AppError> {
    auth::rbac::check_permission(&user, "brokers_manage")?;
    // Verify broker belongs to tenant
    let _config =
        db::postgres::broker_configs::get_broker_config(&state.pg, id, user.tenant_id).await?;

    let stats =
        db::clickhouse::aggregations::get_broker_stats(&state.ch, user.tenant_id, id).await?;
    Ok(Json(stats))
}

#[utoipa::path(
    get,
    path = "/api/v1/brokers/{id}/queues",
    tag = "brokers",
    params(("id" = Uuid, Path, description = "Broker ID")),
    responses((status = 200, description = "Success", body = QueueListResponse))
)]
pub async fn get_broker_queues(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<QueueListResponse>, AppError> {
    auth::rbac::check_permission(&user, "brokers_manage")?;

    let config =
        db::postgres::broker_configs::get_broker_config(&state.pg, id, user.tenant_id).await?;

    let queues =
        crate::broker_conn::commands::queue_stats(&config.broker_type, &config.connection_enc)
            .await
            .map_err(AppError::BadRequest)?;

    Ok(Json(QueueListResponse { data: queues }))
}

#[utoipa::path(
    get,
    path = "/api/v1/queues",
    tag = "brokers",
    responses((status = 200, description = "Success", body = StringListResponse))
)]
pub async fn list_queues(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<StringListResponse>, AppError> {
    auth::rbac::check_permission(&user, "tasks_read")?;
    let names = db::clickhouse::aggregations::get_queue_names(&state.ch, user.tenant_id).await?;
    Ok(Json(StringListResponse { data: names }))
}

// ─── Router ────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/brokers", get(list_brokers).post(create_broker))
        .route("/brokers/test", post(test_connection))
        .route("/brokers/{id}", get(get_broker).delete(delete_broker))
        .route("/brokers/{id}/start", post(start_broker))
        .route("/brokers/{id}/stop", post(stop_broker))
        .route("/brokers/{id}/stats", get(get_broker_stats))
        .route("/brokers/{id}/queues", get(get_broker_queues))
        .route("/queues", get(list_queues))
}
