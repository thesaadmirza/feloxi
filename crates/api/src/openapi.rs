use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Feloxi API",
        version = "1.0.0",
        description = "Celery task monitoring and management API"
    ),
    tags(
        (name = "health", description = "Health and readiness checks"),
        (name = "auth", description = "Authentication and authorization"),
        (name = "tasks", description = "Task monitoring and control"),
        (name = "workers", description = "Worker monitoring and control"),
        (name = "brokers", description = "Broker configuration and management"),
        (name = "alerts", description = "Alert rules and history"),
        (name = "metrics", description = "Metrics and analytics"),
        (name = "settings", description = "Tenant settings and team management"),
        (name = "setup", description = "Instance setup and configuration status"),
        (name = "workflows", description = "Task workflow and chain tracking"),
        (name = "system", description = "System health and pipeline metrics"),
    ),
    paths(
        // Health
        crate::routes::health::healthz,
        crate::routes::health::readyz,
        // Auth
        crate::routes::auth::register,
        crate::routes::auth::login,
        crate::routes::auth::refresh,
        crate::routes::auth::logout,
        crate::routes::auth::me,
        crate::routes::auth::list_user_orgs,
        crate::routes::auth::switch_org,
        crate::routes::auth::get_invite,
        crate::routes::auth::accept_invite,
        // Tasks
        crate::routes::tasks::list_tasks,
        crate::routes::tasks::get_task,
        crate::routes::tasks::get_task_timeline,
        crate::routes::tasks::retry_task,
        crate::routes::tasks::revoke_task,
        crate::routes::tasks::list_task_summary,
        crate::routes::tasks::get_retry_chain,
        // Workers
        crate::routes::workers::list_workers,
        crate::routes::workers::get_worker,
        crate::routes::workers::shutdown_worker,
        crate::routes::workers::worker_task_stats,
        crate::routes::workers::worker_health,
        // Brokers
        crate::routes::brokers::list_brokers,
        crate::routes::brokers::create_broker,
        crate::routes::brokers::get_broker,
        crate::routes::brokers::delete_broker,
        crate::routes::brokers::start_broker,
        crate::routes::brokers::stop_broker,
        crate::routes::brokers::test_connection,
        crate::routes::brokers::get_broker_stats,
        crate::routes::brokers::get_broker_queues,
        crate::routes::brokers::list_queues,
        // Alerts
        crate::routes::alerts::list_rules,
        crate::routes::alerts::create_rule,
        crate::routes::alerts::get_rule,
        crate::routes::alerts::update_rule,
        crate::routes::alerts::delete_rule,
        crate::routes::alerts::list_history,
        // Metrics
        crate::routes::metrics::overview,
        crate::routes::metrics::throughput,
        crate::routes::metrics::queue_metrics,
        crate::routes::metrics::task_names,
        crate::routes::metrics::queue_names,
        crate::routes::metrics::failure_groups,
        crate::routes::metrics::task_name_stats,
        crate::routes::metrics::queue_overview,
        // Settings / Tenants
        crate::routes::tenants::get_settings,
        crate::routes::tenants::get_team,
        crate::routes::tenants::invite_member,
        crate::routes::tenants::remove_member,
        crate::routes::tenants::get_retention,
        crate::routes::tenants::update_retention,
        crate::routes::tenants::get_notifications,
        crate::routes::tenants::update_notifications,
        crate::routes::tenants::test_notification,
        // API Keys
        crate::routes::api_keys::list_keys,
        crate::routes::api_keys::create_key,
        crate::routes::api_keys::revoke_key,
        // Workflows
        crate::routes::workflows::get_workflow,
        // System
        crate::routes::system::pipeline_stats,
        crate::routes::system::system_health,
        crate::routes::system::dead_letters,
        // Setup
        crate::routes::setup::status,
    ),
    components(schemas(
        // Auth types
        crate::routes::auth::RegisterRequest,
        crate::routes::auth::LoginRequest,
        crate::routes::auth::AuthResponse,
        crate::routes::auth::UserInfo,
        crate::routes::auth::OrgPickerResponse,
        crate::routes::auth::OrgSummary,
        crate::routes::auth::SwitchOrgRequest,
        crate::routes::auth::AcceptInviteRequest,
        crate::routes::auth::InvitePreviewResponse,
        // Request types
        crate::routes::tasks::TaskListParams,
        crate::routes::tasks::RetryRequest,
        crate::routes::workers::WorkerListParams,
        crate::routes::workers::WorkerHealthParams,
        crate::routes::brokers::CreateBrokerRequest,
        crate::routes::brokers::TestConnectionRequest,
        crate::routes::alerts::CreateAlertRuleRequest,
        crate::routes::alerts::UpdateAlertRuleRequest,
        crate::routes::alerts::AlertHistoryParams,
        crate::routes::metrics::MetricsParams,
        crate::routes::api_keys::CreateKeyRequest,
        crate::routes::tenants::InviteMemberRequest,
        crate::routes::tenants::RetentionInput,
        crate::routes::tenants::TestNotificationRequest,
        // Health
        crate::routes::health::HealthResponse,
        // DB models (Postgres)
        db::postgres::models::Tenant,
        db::postgres::models::BrokerConfig,
        db::postgres::models::AlertRule,
        db::postgres::models::AlertHistoryRow,
        db::postgres::models::ApiKey,
        db::postgres::models::RetentionPolicy,
        db::postgres::models::Role,
        db::postgres::models::AlertCondition,
        db::postgres::models::AlertChannel,
        db::postgres::models::ChannelDeliveryStatus,
        // DB models (ClickHouse)
        db::clickhouse::task_events::TaskEventRow,
        db::clickhouse::worker_events::WorkerEventRow,
        db::clickhouse::aggregations::OverviewStats,
        db::clickhouse::aggregations::TaskMetricsRow,
        db::clickhouse::aggregations::QueueMetricsRow,
        db::clickhouse::aggregations::BrokerStats,
        db::clickhouse::aggregations::TopTaskRow,
        db::clickhouse::aggregations::WorkerTaskStatsRow,
        db::clickhouse::aggregations::WorkerHeartbeatHealthRow,
        db::clickhouse::aggregations::TaskSummaryRow,
        db::clickhouse::aggregations::FailureGroupRow,
        db::clickhouse::aggregations::TaskNameStatsRow,
        db::clickhouse::aggregations::QueueOverviewRow,
        // DAG types
        engine::dag_resolver::DagNode,
        engine::dag_resolver::DagEdge,
        engine::dag_resolver::WorkflowDag,
        // Broker commands
        crate::broker_conn::commands::QueueInfo,
        // Worker state
        crate::routes::responses::WorkerState,
        // Response types
        crate::routes::responses::TaskListResponse,
        crate::routes::responses::TaskTimelineResponse,
        crate::routes::responses::RetryChainResponse,
        crate::routes::responses::RetryAttempt,
        crate::routes::responses::CommandResponse,
        crate::routes::responses::WorkerListResponse,
        crate::routes::responses::WorkerDetailResponse,
        crate::routes::responses::WorkerTaskStatsResponse,
        crate::routes::responses::WorkerHealthResponse,
        crate::routes::responses::WorkerHealthRow,
        crate::routes::responses::OverviewResponse,
        crate::routes::responses::ThroughputResponse,
        crate::routes::responses::QueueMetricsResponse,
        crate::routes::responses::StringListResponse,
        crate::routes::responses::BrokerListResponse,
        crate::routes::responses::QueueListResponse,
        crate::routes::responses::TestConnectionResponse,
        crate::routes::responses::AlertRulesResponse,
        crate::routes::responses::AlertHistoryResponse,
        crate::routes::responses::ApiKeyListResponse,
        crate::routes::responses::CreateApiKeyResponse,
        crate::routes::responses::TeamMember,
        crate::routes::responses::TeamResponse,
        crate::routes::responses::InviteMemberResponse,
        crate::routes::responses::RetentionResponse,
        crate::routes::responses::NotificationSettings,
        crate::routes::responses::SmtpSettings,
        crate::routes::responses::WebhookDefaults,
        crate::routes::responses::TaskSummaryListResponse,
        crate::routes::responses::FailureGroupsResponse,
        crate::routes::responses::TaskNameStatsResponse,
        crate::routes::responses::QueueOverviewResponse,
        crate::routes::metrics::FailureGroupsParams,
        crate::routes::setup::SetupStatusResponse,
        // System health types
        crate::routes::system::PipelineStatsResponse,
        crate::routes::system::SystemHealthResponse,
        crate::routes::system::ComponentHealth,
        crate::routes::system::StorageInfo,
        crate::routes::system::DeadLetterListResponse,
        db::clickhouse::system::TableStorageRow,
        db::clickhouse::system::DeadLetterRow,
        db::clickhouse::system::DeadLetterSummary,
    ))
)]
pub struct ApiDoc;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_openapi_spec() {
        let spec = ApiDoc::openapi().to_pretty_json().unwrap();
        let out =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/openapi.json");
        std::fs::write(&out, &spec).unwrap();
        // Basic sanity check
        let parsed: serde_json::Value = serde_json::from_str(&spec).unwrap();
        assert_eq!(parsed["info"]["title"], "Feloxi API");
        assert!(parsed["paths"].as_object().unwrap().len() > 30);
    }
}
