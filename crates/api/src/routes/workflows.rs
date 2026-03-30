use axum::{
    extract::{Path, State},
    routing::get,
    Extension, Json, Router,
};

use crate::state::AppState;
use auth::middleware::CurrentUser;
use common::AppError;
use engine::dag_resolver::{self, DagNode, WorkflowDag};

#[utoipa::path(
    get,
    path = "/api/v1/workflows/{root_id}",
    tag = "workflows",
    params(("root_id" = String, Path, description = "Root task ID")),
    responses(
        (status = 200, description = "Workflow DAG", body = WorkflowDag),
        (status = 404, description = "Workflow not found")
    )
)]
pub async fn get_workflow(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(root_id): Path<String>,
) -> Result<Json<WorkflowDag>, AppError> {
    auth::rbac::check_permission(&user, "tasks_read")?;

    let events =
        db::clickhouse::task_events::get_workflow_tasks(&state.ch, user.tenant_id, &root_id)
            .await?;

    if events.is_empty() {
        return Err(AppError::NotFound(format!("Workflow {root_id} not found")));
    }

    let nodes: Vec<DagNode> = events
        .into_iter()
        .map(|e| DagNode {
            task_id: e.task_id,
            task_name: e.task_name,
            state: e.state,
            runtime: if e.runtime > 0.0 { Some(e.runtime) } else { None },
            queue: e.queue,
            worker_id: e.worker_id,
            group_id: e.group_id,
            parent_id: e.parent_id,
            chord_id: e.chord_id,
        })
        .collect();

    let dag = dag_resolver::build_dag(nodes);

    Ok(Json(dag))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/workflows/{root_id}", get(get_workflow))
}
