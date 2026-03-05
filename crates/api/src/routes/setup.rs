use axum::{extract::State, routing::get, Json, Router};
use serde::Serialize;
use utoipa::ToSchema;

use crate::state::AppState;
use common::AppError;

#[derive(Serialize, ToSchema)]
pub struct SetupStatusResponse {
    pub needs_setup: bool,
    pub allow_signup: bool,
}

#[utoipa::path(
    get,
    path = "/api/v1/setup/status",
    tag = "setup",
    responses((status = 200, description = "Setup status", body = SetupStatusResponse))
)]
pub async fn status(State(state): State<AppState>) -> Result<Json<SetupStatusResponse>, AppError> {
    let has_tenants = db::postgres::tenants::has_tenants(&state.pg).await?;
    Ok(Json(SetupStatusResponse {
        needs_setup: !has_tenants,
        allow_signup: state.config.allow_signup,
    }))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/setup/status", get(status))
}
