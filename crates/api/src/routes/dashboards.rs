use axum::{routing::get, Extension, Json, Router};

use crate::state::AppState;
use auth::middleware::CurrentUser;
use common::AppError;

async fn get_dashboard_config(
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Return the user's dashboard configuration
    Ok(Json(serde_json::json!({
        "tenant_id": user.tenant_id,
        "user_id": user.user_id,
        "widgets": [
            {"type": "overview_stats", "position": {"x": 0, "y": 0, "w": 12, "h": 2}},
            {"type": "task_throughput", "position": {"x": 0, "y": 2, "w": 6, "h": 3}},
            {"type": "failure_rate", "position": {"x": 6, "y": 2, "w": 6, "h": 3}},
            {"type": "worker_status", "position": {"x": 0, "y": 5, "w": 4, "h": 3}},
            {"type": "queue_depth", "position": {"x": 4, "y": 5, "w": 4, "h": 3}},
            {"type": "recent_failures", "position": {"x": 8, "y": 5, "w": 4, "h": 3}},
        ]
    })))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/dashboards", get(get_dashboard_config))
}
