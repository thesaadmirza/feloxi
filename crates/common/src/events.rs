use serde::{Deserialize, Serialize};

/// Raw task event from a Celery broker, before normalization into ClickHouse rows.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawTaskEvent {
    pub task_id: String,
    pub task_name: String,
    pub event_type: String,
    pub timestamp: f64,
    pub queue: Option<String>,
    pub worker_id: Option<String>,
    pub state: Option<String>,
    pub args: Option<String>,
    pub kwargs: Option<String>,
    pub result: Option<String>,
    pub exception: Option<String>,
    pub traceback: Option<String>,
    pub runtime: Option<f64>,
    pub retries: Option<u32>,
    pub eta: Option<f64>,
    pub expires: Option<f64>,
    pub root_id: Option<String>,
    pub parent_id: Option<String>,
    pub group_id: Option<String>,
    pub chord_id: Option<String>,
}

/// Raw worker event from a Celery broker, before normalization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawWorkerEvent {
    pub worker_id: String,
    pub hostname: String,
    pub event_type: String,
    pub timestamp: f64,
    pub active_tasks: Option<u32>,
    pub processed: Option<u64>,
    pub load_avg: Option<Vec<f64>>,
    pub cpu_percent: Option<f64>,
    pub memory_mb: Option<f64>,
    pub pool_size: Option<u32>,
    pub pool_type: Option<String>,
    pub sw_ident: Option<String>,
    pub sw_ver: Option<String>,
}

/// Parse a Celery event dict into our normalized format.
///
/// Celery events have an event type string (e.g. "task-received", "task-succeeded")
/// and a JSON body containing task metadata.
pub fn parse_celery_event(event_type: &str, body: &serde_json::Value) -> Option<RawTaskEvent> {
    let task_id = body.get("uuid")?.as_str()?.to_string();
    let task_name = body.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let timestamp = body.get("timestamp")?.as_f64()?;

    Some(RawTaskEvent {
        task_id,
        task_name,
        event_type: event_type.to_string(),
        timestamp,
        queue: body
            .get("queue")
            .or_else(|| body.get("routing_key"))
            .or_else(|| body.pointer("/delivery_info/routing_key"))
            .and_then(|v| v.as_str())
            .map(String::from),
        worker_id: body.get("hostname").and_then(|v| v.as_str()).map(String::from),
        state: None, // Derived from event_type by normalize_task_event
        args: body.get("args").map(|v| v.to_string()),
        kwargs: body.get("kwargs").map(|v| v.to_string()),
        result: body.get("result").map(|v| v.to_string()),
        exception: body.get("exception").and_then(|v| v.as_str()).map(String::from),
        traceback: body.get("traceback").and_then(|v| v.as_str()).map(String::from),
        runtime: body.get("runtime").and_then(|v| v.as_f64()),
        retries: body.get("retries").and_then(|v| v.as_u64()).map(|v| v as u32),
        eta: body.get("eta").and_then(|v| v.as_f64()),
        expires: body.get("expires").and_then(|v| v.as_f64()),
        root_id: body.get("root_id").and_then(|v| v.as_str()).map(String::from),
        parent_id: body.get("parent_id").and_then(|v| v.as_str()).map(String::from),
        group_id: body.get("group").and_then(|v| v.as_str()).map(String::from),
        chord_id: body.get("chord").and_then(|v| v.as_str()).map(String::from),
    })
}

/// Parse a Celery worker event dict into our normalized format.
///
/// Celery worker events have types like "worker-online", "worker-heartbeat",
/// "worker-offline". The `hostname` field (e.g. "celery@worker1") serves as
/// the unique worker identifier.
pub fn parse_celery_worker_event(
    event_type: &str,
    body: &serde_json::Value,
) -> Option<RawWorkerEvent> {
    let hostname = body.get("hostname")?.as_str()?.to_string();
    let timestamp = body.get("timestamp")?.as_f64()?;

    Some(RawWorkerEvent {
        worker_id: hostname.clone(),
        hostname,
        event_type: event_type.to_string(),
        timestamp,
        active_tasks: body.get("active").and_then(|v| v.as_u64()).map(|v| v as u32),
        processed: body.get("processed").and_then(|v| v.as_u64()),
        load_avg: body
            .get("loadavg")
            .and_then(|v| v.as_array().map(|arr| arr.iter().filter_map(|x| x.as_f64()).collect())),
        cpu_percent: None, // Not in standard Celery heartbeat events
        memory_mb: None,   // Not in standard Celery heartbeat events
        pool_size: body.get("pool_size").and_then(|v| v.as_u64()).map(|v| v as u32),
        pool_type: body.get("pool_type").and_then(|v| v.as_str()).map(String::from),
        sw_ident: body.get("sw_ident").and_then(|v| v.as_str()).map(String::from),
        sw_ver: body.get("sw_ver").and_then(|v| v.as_str()).map(String::from),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_task_received() {
        let body = serde_json::json!({
            "uuid": "abc-123",
            "name": "tasks.add",
            "timestamp": 1700000000.5,
            "queue": "default",
            "hostname": "celery@worker1",
            "args": [1, 2],
            "kwargs": {}
        });

        let event = parse_celery_event("task-received", &body).unwrap();
        assert_eq!(event.task_id, "abc-123");
        assert_eq!(event.task_name, "tasks.add");
        assert_eq!(event.event_type, "task-received");
        assert_eq!(event.timestamp, 1700000000.5);
        assert_eq!(event.queue.as_deref(), Some("default"));
        assert_eq!(event.worker_id.as_deref(), Some("celery@worker1"));
    }

    #[test]
    fn parse_worker_heartbeat() {
        let body = serde_json::json!({
            "hostname": "celery@worker2",
            "timestamp": 1700000001.0,
            "active": 5,
            "processed": 1000,
            "loadavg": [1.5, 1.0, 0.5],
            "sw_ident": "py-celery",
            "sw_ver": "5.3.0",
            "freq": 2.0
        });

        let event = parse_celery_worker_event("worker-heartbeat", &body).unwrap();
        assert_eq!(event.worker_id, "celery@worker2");
        assert_eq!(event.active_tasks, Some(5));
        assert_eq!(event.processed, Some(1000));
        assert_eq!(event.load_avg.as_ref().unwrap().len(), 3);
    }

    #[test]
    fn parse_missing_uuid_returns_none() {
        let body = serde_json::json!({
            "name": "tasks.add",
            "timestamp": 1700000000.0
        });
        assert!(parse_celery_event("task-received", &body).is_none());
    }

    #[test]
    fn parse_missing_hostname_returns_none() {
        let body = serde_json::json!({
            "timestamp": 1700000000.0
        });
        assert!(parse_celery_worker_event("worker-online", &body).is_none());
    }
}
