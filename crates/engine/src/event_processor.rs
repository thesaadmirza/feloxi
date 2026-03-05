use common::{RawTaskEvent, RawWorkerEvent};
use db::clickhouse::task_events::TaskEventRow;
use db::clickhouse::worker_events::WorkerEventRow;
use uuid::Uuid;

/// Normalize a raw task event from an agent into a ClickHouse row.
pub fn normalize_task_event(
    tenant_id: Uuid,
    agent_id: Uuid,
    broker_type: &str,
    raw: &RawTaskEvent,
) -> TaskEventRow {
    let state = raw
        .state
        .clone()
        .unwrap_or_else(|| event_type_to_state(&raw.event_type));

    let ts_secs = raw.timestamp as i64;
    let ts_nanos = ((raw.timestamp - ts_secs as f64) * 1_000_000_000.0) as i64;
    let timestamp = time::OffsetDateTime::from_unix_timestamp(ts_secs)
        .unwrap_or(time::OffsetDateTime::now_utc())
        + time::Duration::nanoseconds(ts_nanos);

    TaskEventRow {
        tenant_id,
        event_id: Uuid::new_v4(),
        task_id: raw.task_id.clone(),
        task_name: raw.task_name.clone(),
        queue: raw.queue.clone().unwrap_or_default(),
        worker_id: raw.worker_id.clone().unwrap_or_default(),
        state,
        event_type: raw.event_type.clone(),
        timestamp,
        args: raw.args.clone().unwrap_or_default(),
        kwargs: raw.kwargs.clone().unwrap_or_default(),
        result: raw.result.clone().unwrap_or_default(),
        exception: raw.exception.clone().unwrap_or_default(),
        traceback: raw.traceback.clone().unwrap_or_default(),
        runtime: raw.runtime.unwrap_or(0.0),
        retries: raw.retries.unwrap_or(0),
        root_id: raw.root_id.clone(),
        parent_id: raw.parent_id.clone(),
        group_id: raw.group_id.clone(),
        chord_id: raw.chord_id.clone(),
        agent_id,
        broker_type: broker_type.to_string(),
    }
}

/// Normalize a raw worker event from an agent into a ClickHouse row.
pub fn normalize_worker_event(
    tenant_id: Uuid,
    agent_id: Uuid,
    raw: &RawWorkerEvent,
) -> WorkerEventRow {
    let ts_secs = raw.timestamp as i64;
    let timestamp = time::OffsetDateTime::from_unix_timestamp(ts_secs)
        .unwrap_or(time::OffsetDateTime::now_utc());

    WorkerEventRow {
        tenant_id,
        event_id: Uuid::new_v4(),
        worker_id: raw.worker_id.clone(),
        hostname: raw.hostname.clone(),
        event_type: raw.event_type.clone(),
        timestamp,
        active_tasks: raw.active_tasks.unwrap_or(0),
        processed: raw.processed.unwrap_or(0),
        load_avg: raw.load_avg.clone().unwrap_or_default(),
        cpu_percent: raw.cpu_percent.unwrap_or(0.0),
        memory_mb: raw.memory_mb.unwrap_or(0.0),
        pool_size: raw.pool_size.unwrap_or(0),
        pool_type: raw.pool_type.clone().unwrap_or_default(),
        sw_ident: raw.sw_ident.clone().unwrap_or_default(),
        sw_ver: raw.sw_ver.clone().unwrap_or_default(),
        agent_id,
    }
}

/// Map Celery event types to task states.
fn event_type_to_state(event_type: &str) -> String {
    match event_type {
        "task-sent" => "PENDING",
        "task-received" => "RECEIVED",
        "task-started" => "STARTED",
        "task-succeeded" => "SUCCESS",
        "task-failed" => "FAILURE",
        "task-retried" => "RETRY",
        "task-revoked" => "REVOKED",
        "task-rejected" => "REJECTED",
        _ => "PENDING",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── normalize_task_event ──────────────────────────────────

    #[test]
    fn normalize_task_event_with_explicit_state() {
        let tenant_id = Uuid::new_v4();
        let agent_id = Uuid::new_v4();
        let raw = RawTaskEvent {
            task_id: "task-1".into(),
            task_name: "add".into(),
            event_type: "task-succeeded".into(),
            timestamp: 1700000000.5,
            queue: Some("default".into()),
            worker_id: Some("w1".into()),
            state: Some("SUCCESS".into()),
            args: Some("[1,2]".into()),
            kwargs: Some("{\"x\":1}".into()),
            result: Some("3".into()),
            exception: None,
            traceback: None,
            runtime: Some(0.123),
            retries: Some(2),
            eta: None,
            expires: None,
            root_id: Some("root-1".into()),
            parent_id: Some("parent-1".into()),
            group_id: Some("group-1".into()),
            chord_id: Some("chord-1".into()),
        };

        let row = normalize_task_event(tenant_id, agent_id, "redis", &raw);

        assert_eq!(row.tenant_id, tenant_id);
        assert_eq!(row.agent_id, agent_id);
        assert_eq!(row.task_id, "task-1");
        assert_eq!(row.task_name, "add");
        assert_eq!(row.state, "SUCCESS");
        assert_eq!(row.event_type, "task-succeeded");
        assert_eq!(row.queue, "default");
        assert_eq!(row.worker_id, "w1");
        assert_eq!(row.args, "[1,2]");
        assert_eq!(row.kwargs, "{\"x\":1}");
        assert_eq!(row.result, "3");
        assert_eq!(row.exception, "");
        assert_eq!(row.traceback, "");
        assert!((row.runtime - 0.123).abs() < f64::EPSILON);
        assert_eq!(row.retries, 2);
        assert_eq!(row.root_id, Some("root-1".into()));
        assert_eq!(row.parent_id, Some("parent-1".into()));
        assert_eq!(row.group_id, Some("group-1".into()));
        assert_eq!(row.chord_id, Some("chord-1".into()));
        assert_eq!(row.broker_type, "redis");
    }

    #[test]
    fn normalize_task_event_without_state_uses_event_type() {
        let raw = RawTaskEvent {
            task_id: "t2".into(),
            task_name: "sub".into(),
            event_type: "task-failed".into(),
            timestamp: 1700000000.0,
            queue: None,
            worker_id: None,
            state: None,
            args: None,
            kwargs: None,
            result: None,
            exception: None,
            traceback: None,
            runtime: None,
            retries: None,
            eta: None,
            expires: None,
            root_id: None,
            parent_id: None,
            group_id: None,
            chord_id: None,
        };

        let row = normalize_task_event(Uuid::nil(), Uuid::nil(), "rabbitmq", &raw);

        // Should derive state from event_type
        assert_eq!(row.state, "FAILURE");
        // Optional fields should default
        assert_eq!(row.queue, "");
        assert_eq!(row.worker_id, "");
        assert_eq!(row.args, "");
        assert_eq!(row.kwargs, "");
        assert_eq!(row.result, "");
        assert!((row.runtime - 0.0).abs() < f64::EPSILON);
        assert_eq!(row.retries, 0);
        assert!(row.root_id.is_none());
        assert!(row.parent_id.is_none());
    }

    #[test]
    fn normalize_task_event_timestamp_conversion() {
        let raw = RawTaskEvent {
            task_id: "t3".into(),
            task_name: "test".into(),
            event_type: "task-sent".into(),
            timestamp: 1700000000.0,
            queue: None,
            worker_id: None,
            state: None,
            args: None,
            kwargs: None,
            result: None,
            exception: None,
            traceback: None,
            runtime: None,
            retries: None,
            eta: None,
            expires: None,
            root_id: None,
            parent_id: None,
            group_id: None,
            chord_id: None,
        };

        let row = normalize_task_event(Uuid::nil(), Uuid::nil(), "redis", &raw);
        // The unix timestamp should be 1700000000
        assert_eq!(row.timestamp.unix_timestamp(), 1700000000);
    }

    #[test]
    fn normalize_task_event_generates_unique_event_id() {
        let raw = RawTaskEvent {
            task_id: "t4".into(),
            task_name: "test".into(),
            event_type: "task-sent".into(),
            timestamp: 100.0,
            queue: None,
            worker_id: None,
            state: None,
            args: None,
            kwargs: None,
            result: None,
            exception: None,
            traceback: None,
            runtime: None,
            retries: None,
            eta: None,
            expires: None,
            root_id: None,
            parent_id: None,
            group_id: None,
            chord_id: None,
        };

        let row1 = normalize_task_event(Uuid::nil(), Uuid::nil(), "redis", &raw);
        let row2 = normalize_task_event(Uuid::nil(), Uuid::nil(), "redis", &raw);
        assert_ne!(row1.event_id, row2.event_id);
    }

    // ─── normalize_worker_event ────────────────────────────────

    #[test]
    fn normalize_worker_event_full() {
        let tenant_id = Uuid::new_v4();
        let agent_id = Uuid::new_v4();
        let raw = RawWorkerEvent {
            worker_id: "celery@worker-1".into(),
            hostname: "worker-1.local".into(),
            event_type: "worker-heartbeat".into(),
            timestamp: 1700000000.0,
            active_tasks: Some(5),
            processed: Some(1000),
            load_avg: Some(vec![1.5, 1.0, 0.5]),
            cpu_percent: Some(75.5),
            memory_mb: Some(512.0),
            pool_size: Some(8),
            pool_type: Some("prefork".into()),
            sw_ident: Some("celery".into()),
            sw_ver: Some("5.3.0".into()),
        };

        let row = normalize_worker_event(tenant_id, agent_id, &raw);

        assert_eq!(row.tenant_id, tenant_id);
        assert_eq!(row.agent_id, agent_id);
        assert_eq!(row.worker_id, "celery@worker-1");
        assert_eq!(row.hostname, "worker-1.local");
        assert_eq!(row.event_type, "worker-heartbeat");
        assert_eq!(row.active_tasks, 5);
        assert_eq!(row.processed, 1000);
        assert_eq!(row.load_avg.len(), 3);
        assert!((row.cpu_percent - 75.5).abs() < f64::EPSILON);
        assert!((row.memory_mb - 512.0).abs() < f64::EPSILON);
        assert_eq!(row.pool_size, 8);
        assert_eq!(row.pool_type, "prefork");
        assert_eq!(row.sw_ident, "celery");
        assert_eq!(row.sw_ver, "5.3.0");
    }

    #[test]
    fn normalize_worker_event_defaults_none_fields() {
        let raw = RawWorkerEvent {
            worker_id: "w1".into(),
            hostname: "h1".into(),
            event_type: "worker-online".into(),
            timestamp: 100.0,
            active_tasks: None,
            processed: None,
            load_avg: None,
            cpu_percent: None,
            memory_mb: None,
            pool_size: None,
            pool_type: None,
            sw_ident: None,
            sw_ver: None,
        };

        let row = normalize_worker_event(Uuid::nil(), Uuid::nil(), &raw);

        assert_eq!(row.active_tasks, 0);
        assert_eq!(row.processed, 0);
        assert!(row.load_avg.is_empty());
        assert!((row.cpu_percent - 0.0).abs() < f64::EPSILON);
        assert!((row.memory_mb - 0.0).abs() < f64::EPSILON);
        assert_eq!(row.pool_size, 0);
        assert_eq!(row.pool_type, "");
        assert_eq!(row.sw_ident, "");
        assert_eq!(row.sw_ver, "");
    }

    #[test]
    fn normalize_worker_event_timestamp_conversion() {
        let raw = RawWorkerEvent {
            worker_id: "w1".into(),
            hostname: "h1".into(),
            event_type: "worker-online".into(),
            timestamp: 1700000000.0,
            active_tasks: None,
            processed: None,
            load_avg: None,
            cpu_percent: None,
            memory_mb: None,
            pool_size: None,
            pool_type: None,
            sw_ident: None,
            sw_ver: None,
        };

        let row = normalize_worker_event(Uuid::nil(), Uuid::nil(), &raw);
        assert_eq!(row.timestamp.unix_timestamp(), 1700000000);
    }
}
