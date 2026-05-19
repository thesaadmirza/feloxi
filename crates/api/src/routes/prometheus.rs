use axum::{
    extract::State,
    http::{header, StatusCode},
    response::Response,
    routing::get,
    Router,
};
use futures::future::join_all;

use crate::state::AppState;

pub async fn metrics_handler(State(state): State<AppState>) -> Response<String> {
    // No auth — the Prometheus scrape path is typically protected by network
    // policy in production. Aggregates across all tenants (single-tenant is
    // the overwhelmingly common case; multi-tenant installs get summed totals).
    let mut out = String::with_capacity(2048);

    let tenant_ids: Vec<uuid::Uuid> = db::postgres::tenants::list_tenants(&state.pg, 200, 0)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|t| t.id)
        .collect();

    // Fetch overview stats, queue depths, and online workers for all tenants
    // in parallel to keep scrape latency O(slowest_query) not O(N*queries).
    let (overview_results, depths_results, workers_results) = tokio::join!(
        join_all(
            tenant_ids
                .iter()
                .map(|&tid| db::clickhouse::aggregations::get_overview_stats(&state.ch, tid, 60))
        ),
        join_all(
            tenant_ids.iter().map(|&tid| db::redis::cache::get_queue_depths(&state.redis, tid))
        ),
        join_all(
            tenant_ids.iter().map(|&tid| db::redis::cache::get_online_workers(&state.redis, tid))
        ),
    );

    // ── Task counts ──────────────────────────────────────────────────────────
    let mut total = 0u64;
    let mut succeeded = 0u64;
    let mut failed = 0u64;
    let mut avg_runtime_sum = 0f64;
    let mut avg_runtime_count = 0u64;

    for result in overview_results {
        if let Ok(stats) = result {
            total += stats.total_tasks;
            succeeded += stats.success_count;
            failed += stats.failure_count;
            if stats.avg_runtime > 0.0 {
                avg_runtime_sum += stats.avg_runtime;
                avg_runtime_count += 1;
            }
        }
    }

    out.push_str("# HELP feloxi_tasks_total Number of tasks in the last 60 minutes by state\n");
    out.push_str("# TYPE feloxi_tasks_total gauge\n");
    out.push_str(&format!("feloxi_tasks_total{{state=\"total\"}} {total}\n"));
    out.push_str(&format!("feloxi_tasks_total{{state=\"succeeded\"}} {succeeded}\n"));
    out.push_str(&format!("feloxi_tasks_total{{state=\"failed\"}} {failed}\n"));

    let failure_rate = if total > 0 { (failed as f64 / total as f64) * 100.0 } else { 0.0 };
    out.push_str(
        "# HELP feloxi_task_failure_rate_percent Task failure rate over the last 60 minutes (0-100)\n",
    );
    out.push_str("# TYPE feloxi_task_failure_rate_percent gauge\n");
    out.push_str(&format!("feloxi_task_failure_rate_percent {failure_rate:.2}\n"));

    let avg_runtime =
        if avg_runtime_count > 0 { avg_runtime_sum / avg_runtime_count as f64 } else { 0.0 };
    out.push_str(
        "# HELP feloxi_task_avg_runtime_seconds Average task runtime over the last 60 minutes\n",
    );
    out.push_str("# TYPE feloxi_task_avg_runtime_seconds gauge\n");
    out.push_str(&format!("feloxi_task_avg_runtime_seconds {avg_runtime:.3}\n"));

    // ── Queue depths ─────────────────────────────────────────────────────────
    out.push_str("# HELP feloxi_queue_depth Live queue depth reported by the broker\n");
    out.push_str("# TYPE feloxi_queue_depth gauge\n");

    for result in depths_results {
        if let Ok(depths) = result {
            for (queue, depth) in depths {
                let safe = queue.replace('"', "\\\"");
                out.push_str(&format!("feloxi_queue_depth{{queue=\"{safe}\"}} {depth}\n"));
            }
        }
    }

    // ── Online workers ───────────────────────────────────────────────────────
    let online_total: u64 =
        workers_results.into_iter().filter_map(|r| r.ok()).map(|w| w.len() as u64).sum();

    out.push_str("# HELP feloxi_workers_online Number of workers that sent a heartbeat recently\n");
    out.push_str("# TYPE feloxi_workers_online gauge\n");
    out.push_str(&format!("feloxi_workers_online {online_total}\n"));

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")
        .body(out)
        .unwrap()
}

pub fn router() -> Router<AppState> {
    Router::new().route("/metrics", get(metrics_handler))
}
