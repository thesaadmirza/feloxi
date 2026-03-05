use uuid::Uuid;

/// Redis key patterns for Feloxi.
/// All keys are prefixed with `fp:` to avoid collisions.

pub fn worker_state(tenant_id: Uuid, worker_id: &str) -> String {
    format!("fp:{tenant_id}:worker:{worker_id}:state")
}

pub fn worker_heartbeat(tenant_id: Uuid, worker_id: &str) -> String {
    format!("fp:{tenant_id}:worker:{worker_id}:heartbeat")
}

pub fn workers_online(tenant_id: Uuid) -> String {
    format!("fp:{tenant_id}:workers:online")
}

pub fn task_state(tenant_id: Uuid, task_id: &str) -> String {
    format!("fp:{tenant_id}:task:{task_id}:state")
}

pub fn tasks_recent(tenant_id: Uuid) -> String {
    format!("fp:{tenant_id}:tasks:recent")
}

pub fn queue_depth(tenant_id: Uuid, queue_name: &str) -> String {
    format!("fp:{tenant_id}:queue:{queue_name}:depth")
}

pub fn queues_active(tenant_id: Uuid) -> String {
    format!("fp:{tenant_id}:queues:active")
}

pub fn beat_schedule(tenant_id: Uuid) -> String {
    format!("fp:{tenant_id}:beat:schedule")
}

pub fn beat_last_run(tenant_id: Uuid, schedule_name: &str) -> String {
    format!("fp:{tenant_id}:beat:last_run:{schedule_name}")
}

pub fn rate_limit_api(tenant_id: Uuid) -> String {
    format!("fp:ratelimit:{tenant_id}:api")
}

pub fn rate_limit_events(tenant_id: Uuid) -> String {
    format!("fp:ratelimit:{tenant_id}:events")
}

pub fn pubsub_events(tenant_id: Uuid) -> String {
    format!("fp:pubsub:{tenant_id}:events")
}

pub fn pubsub_alerts(tenant_id: Uuid) -> String {
    format!("fp:pubsub:{tenant_id}:alerts")
}

pub fn agent_connected(tenant_id: Uuid, agent_id: Uuid) -> String {
    format!("fp:{tenant_id}:agent:{agent_id}:connected")
}

pub fn alert_cooldown(tenant_id: Uuid, rule_id: Uuid) -> String {
    format!("fp:{tenant_id}:alert:{rule_id}:cooldown")
}

pub fn alert_state(tenant_id: Uuid, rule_id: Uuid) -> String {
    format!("fp:{tenant_id}:alert:{rule_id}:state")
}

pub fn session(session_id: &str) -> String {
    format!("fp:session:{session_id}")
}

pub fn refresh_token(user_id: Uuid, token_hash: &str) -> String {
    format!("fp:refresh:{user_id}:{token_hash}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tid() -> Uuid { Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap() }
    fn tid2() -> Uuid { Uuid::parse_str("6ba7b810-9dad-11d1-80b4-00c04fd430c8").unwrap() }

    #[test]
    fn all_key_formats_and_prefix() {
        let t = tid();
        let r = tid2();
        let cases: Vec<(String, String)> = vec![
            (worker_state(t, "w1"), format!("fp:{t}:worker:w1:state")),
            (worker_heartbeat(t, "w1"), format!("fp:{t}:worker:w1:heartbeat")),
            (workers_online(t), format!("fp:{t}:workers:online")),
            (task_state(t, "t1"), format!("fp:{t}:task:t1:state")),
            (tasks_recent(t), format!("fp:{t}:tasks:recent")),
            (queue_depth(t, "q1"), format!("fp:{t}:queue:q1:depth")),
            (queues_active(t), format!("fp:{t}:queues:active")),
            (beat_schedule(t), format!("fp:{t}:beat:schedule")),
            (beat_last_run(t, "job"), format!("fp:{t}:beat:last_run:job")),
            (rate_limit_api(t), format!("fp:ratelimit:{t}:api")),
            (rate_limit_events(t), format!("fp:ratelimit:{t}:events")),
            (pubsub_events(t), format!("fp:pubsub:{t}:events")),
            (pubsub_alerts(t), format!("fp:pubsub:{t}:alerts")),
            (agent_connected(t, r), format!("fp:{t}:agent:{r}:connected")),
            (alert_cooldown(t, r), format!("fp:{t}:alert:{r}:cooldown")),
            (alert_state(t, r), format!("fp:{t}:alert:{r}:state")),
            (session("sid"), "fp:session:sid".into()),
            (refresh_token(t, "hash"), format!("fp:refresh:{t}:hash")),
        ];
        for (actual, expected) in &cases {
            assert!(actual.starts_with("fp:"), "missing prefix: {actual}");
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn key_uniqueness_no_collisions() {
        let t = tid();
        let keys = vec![
            worker_state(t, "w1"), worker_heartbeat(t, "w1"), workers_online(t),
            task_state(t, "w1"), tasks_recent(t), queue_depth(t, "w1"),
            queues_active(t), beat_schedule(t), beat_last_run(t, "w1"),
            rate_limit_api(t), rate_limit_events(t), pubsub_events(t),
            pubsub_alerts(t), session("w1"),
        ];
        let unique: std::collections::HashSet<&String> = keys.iter().collect();
        assert_eq!(unique.len(), keys.len());
    }

    #[test]
    fn tenant_isolation() {
        let t1 = tid();
        let t2 = tid2();
        assert_ne!(worker_state(t1, "w"), worker_state(t2, "w"));
        assert_ne!(workers_online(t1), workers_online(t2));
        assert_ne!(task_state(t1, "t"), task_state(t2, "t"));
        assert_ne!(queue_depth(t1, "q"), queue_depth(t2, "q"));
        assert_ne!(beat_schedule(t1), beat_schedule(t2));
        assert_ne!(pubsub_events(t1), pubsub_events(t2));
        assert_ne!(rate_limit_api(t1), rate_limit_api(t2));
    }

    #[test]
    fn special_characters_in_ids() {
        let t = tid();
        assert!(worker_state(t, "celery@host.example.com").contains("celery@host.example.com"));
        assert!(queue_depth(t, "my-queue.high-priority").contains("my-queue.high-priority"));
    }
}
