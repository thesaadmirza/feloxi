use axum::{extract::State, routing::get, Extension, Json, Router};

use crate::state::AppState;
use auth::middleware::CurrentUser;
use common::AppError;

async fn get_schedules(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth::rbac::check_permission(&user, "beat_read")?;

    let key = db::redis::keys::beat_schedule(user.tenant_id);
    let schedule: Option<serde_json::Value> =
        db::redis::cache::get_json(&state.redis, &key)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "schedules": schedule.unwrap_or(serde_json::json!([])),
    })))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/beat/schedules", get(get_schedules))
}