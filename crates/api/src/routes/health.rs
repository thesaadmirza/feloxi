use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use serde::Serialize;
use utoipa::ToSchema;

use crate::state::AppState;

#[derive(Serialize, ToSchema)]
pub struct HealthResponse {
    status: &'static str,
    version: &'static str,
}

#[utoipa::path(
    get,
    path = "/api/v1/healthz",
    tag = "health",
    responses((status = 200, description = "Success", body = HealthResponse))
)]
pub async fn healthz() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

#[utoipa::path(
    get,
    path = "/api/v1/readyz",
    tag = "health",
    responses((status = 200, description = "Success", body = HealthResponse))
)]
pub async fn readyz(State(state): State<AppState>) -> Result<Json<HealthResponse>, StatusCode> {
    // Check PostgreSQL connectivity
    sqlx::query("SELECT 1")
        .execute(&state.pg)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;

    Ok(Json(HealthResponse {
        status: "ready",
        version: env!("CARGO_PKG_VERSION"),
    }))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
}
