use axum::{
    extract::{ws::{Message, WebSocket}, Query, State, WebSocketUpgrade},
    response::IntoResponse,
};
use futures::{SinkExt, StreamExt};
use std::collections::HashSet;

use crate::state::{AppState, TenantEvent};
use crate::ws::subscriptions::{SubscriptionTopic, WsClientCommand, WsServerMessage};

#[derive(serde::Deserialize, Default)]
pub struct WsParams {
    pub token: Option<String>,
}

/// Extract access token from cookie header.
fn extract_cookie_token(headers: &axum::http::HeaderMap) -> Option<String> {
    headers
        .get_all("cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|s| s.split(';'))
        .map(|s| s.trim())
        .find(|s| s.starts_with("fp_access="))
        .map(|s| s.trim_start_matches("fp_access=").to_string())
}

pub async fn dashboard_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(params): Query<WsParams>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    // Try query param first (API key / backward compat), then cookie
    let token = params
        .token
        .or_else(|| extract_cookie_token(&headers));

    let token = match token {
        Some(t) if !t.is_empty() => t,
        _ => return axum::http::StatusCode::UNAUTHORIZED.into_response(),
    };

    let claims = match auth::jwt::verify_access_token(&state.jwt_keys, &token) {
        Ok(c) => c,
        Err(_) => {
            return axum::http::StatusCode::UNAUTHORIZED.into_response();
        }
    };

    ws.on_upgrade(move |socket| handle_dashboard_socket(socket, state, claims.tid))
        .into_response()
}

async fn handle_dashboard_socket(
    socket: WebSocket,
    state: AppState,
    tenant_id: uuid::Uuid,
) {
    let (mut sender, mut receiver) = socket.split();
    let mut event_rx = state.event_tx.subscribe();
    let mut subscriptions: HashSet<SubscriptionTopic> = HashSet::new();

    // Default: subscribe to everything
    subscriptions.insert(SubscriptionTopic::AllTasks);
    subscriptions.insert(SubscriptionTopic::AllWorkers);
    subscriptions.insert(SubscriptionTopic::Alerts);
    subscriptions.insert(SubscriptionTopic::MetricsSummary);

    loop {
        tokio::select! {
            // Handle messages from the client
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(cmd) = serde_json::from_str::<WsClientCommand>(&text) {
                            match cmd {
                                WsClientCommand::Subscribe { topics } => {
                                    subscriptions.extend(topics.clone());
                                    let resp = WsServerMessage::Subscribed { topics };
                                    let json = serde_json::to_string(&resp).unwrap_or_default();
                                    if sender.send(Message::Text(json.into())).await.is_err() {
                                        break;
                                    }
                                }
                                WsClientCommand::Unsubscribe { topics } => {
                                    for t in topics {
                                        subscriptions.remove(&t);
                                    }
                                }
                                WsClientCommand::Ping => {
                                    let pong = serde_json::to_string(&WsServerMessage::Pong).unwrap_or_default();
                                    if sender.send(Message::Text(pong.into())).await.is_err() {
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
            // Forward matching events from broadcast channel
            event = event_rx.recv() => {
                match event {
                    Ok(tenant_event) => {
                        if tenant_event.tenant_id != tenant_id {
                            continue;
                        }

                        // Check if event matches any subscription
                        if !matches_any_subscription(&tenant_event, &subscriptions) {
                            continue;
                        }

                        let msg = WsServerMessage::Event {
                            payload: serde_json::to_value(&tenant_event.payload).unwrap_or_default(),
                        };
                        let json = serde_json::to_string(&msg).unwrap_or_default();
                        if sender.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("Dashboard WS lagged by {n} events");
                    }
                    Err(_) => break,
                }
            }
        }
    }

    tracing::debug!("Dashboard WebSocket disconnected for tenant {tenant_id}");
}

fn matches_any_subscription(
    event: &TenantEvent,
    subscriptions: &HashSet<SubscriptionTopic>,
) -> bool {
    use crate::state::EventPayload;

    for topic in subscriptions {
        let matches = match (&event.payload, topic) {
            (EventPayload::TaskUpdate { .. }, SubscriptionTopic::AllTasks) => true,
            (EventPayload::TaskUpdate { queue, .. }, SubscriptionTopic::Queue { queue: q }) => {
                queue == q
            }
            (EventPayload::TaskUpdate { task_id, .. }, SubscriptionTopic::Task { task_id: tid }) => {
                task_id == tid
            }
            (EventPayload::TaskUpdate { task_name, .. }, SubscriptionTopic::TaskType { task_name: tn }) => {
                task_name == tn
            }
            (EventPayload::WorkerUpdate { .. }, SubscriptionTopic::AllWorkers) => true,
            (EventPayload::WorkerUpdate { worker_id, .. }, SubscriptionTopic::Worker { worker_id: wid }) => {
                worker_id == wid
            }
            (EventPayload::BeatUpdate { .. }, SubscriptionTopic::Beat) => true,
            (EventPayload::AlertFired { .. }, SubscriptionTopic::Alerts) => true,
            (EventPayload::MetricsSummary { .. }, SubscriptionTopic::MetricsSummary) => true,
            _ => false,
        };
        if matches {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::EventPayload;
    use uuid::Uuid;

    fn make_task_event(task_id: &str, task_name: &str, queue: &str, worker_id: &str) -> TenantEvent {
        TenantEvent {
            tenant_id: Uuid::nil(),
            payload: EventPayload::TaskUpdate {
                task_id: task_id.into(), task_name: task_name.into(), state: "SUCCESS".into(),
                queue: queue.into(), worker_id: worker_id.into(), runtime: Some(1.0), timestamp: 1700000000.0,
            },
        }
    }
    fn make_worker_event(worker_id: &str) -> TenantEvent {
        TenantEvent { tenant_id: Uuid::nil(), payload: EventPayload::WorkerUpdate {
            worker_id: worker_id.into(), hostname: "host1".into(), status: "online".into(),
            active_tasks: 3, cpu_percent: 50.0, memory_mb: 256.0,
        }}
    }
    fn make_beat_event() -> TenantEvent {
        TenantEvent { tenant_id: Uuid::nil(), payload: EventPayload::BeatUpdate {
            schedule_name: "cleanup".into(), task_name: "tasks.cleanup".into(),
            last_run_at: Some(1700000000.0), next_run_at: Some(1700003600.0),
        }}
    }
    fn make_alert_event() -> TenantEvent {
        TenantEvent { tenant_id: Uuid::nil(), payload: EventPayload::AlertFired {
            rule_id: Uuid::nil(), rule_name: "High failure rate".into(),
            severity: "critical".into(), summary: "Failure rate > 50%".into(),
        }}
    }
    fn make_metrics_event() -> TenantEvent {
        TenantEvent { tenant_id: Uuid::nil(), payload: EventPayload::MetricsSummary {
            throughput: 100.0, failure_rate: 0.05, active_workers: 3, queue_depth: 10,
        }}
    }

    #[test]
    fn single_topic_matching() {
        // Each subscription topic should match its event type and reject others
        let cases: Vec<(HashSet<SubscriptionTopic>, Vec<(TenantEvent, bool)>)> = vec![
            (
                [SubscriptionTopic::AllTasks].into_iter().collect(),
                vec![
                    (make_task_event("t1", "tasks.add", "default", "w1"), true),
                    (make_worker_event("w1"), false),
                    (make_beat_event(), false),
                ],
            ),
            (
                [SubscriptionTopic::Queue { queue: "emails".into() }].into_iter().collect(),
                vec![
                    (make_task_event("t1", "send_email", "emails", "w1"), true),
                    (make_task_event("t1", "send_email", "default", "w1"), false),
                    (make_worker_event("w1"), false),
                ],
            ),
            (
                [SubscriptionTopic::Task { task_id: "task-abc".into() }].into_iter().collect(),
                vec![
                    (make_task_event("task-abc", "tasks.add", "default", "w1"), true),
                    (make_task_event("task-xyz", "tasks.add", "default", "w1"), false),
                    (make_worker_event("task-abc"), false), // cross-type: same ID, wrong event type
                ],
            ),
            (
                [SubscriptionTopic::TaskType { task_name: "tasks.send_email".into() }].into_iter().collect(),
                vec![
                    (make_task_event("t1", "tasks.send_email", "default", "w1"), true),
                    (make_task_event("t1", "tasks.process_payment", "default", "w1"), false),
                ],
            ),
            (
                [SubscriptionTopic::AllWorkers].into_iter().collect(),
                vec![
                    (make_worker_event("celery@host1"), true),
                    (make_task_event("t1", "tasks.add", "default", "w1"), false),
                ],
            ),
            (
                [SubscriptionTopic::Worker { worker_id: "celery@host1".into() }].into_iter().collect(),
                vec![
                    (make_worker_event("celery@host1"), true),
                    (make_worker_event("celery@host2"), false),
                    (make_task_event("t1", "tasks.add", "default", "celery@host1"), false), // cross-type
                ],
            ),
            (
                [SubscriptionTopic::Beat].into_iter().collect(),
                vec![(make_beat_event(), true), (make_task_event("t1", "n", "q", "w"), false)],
            ),
            (
                [SubscriptionTopic::Alerts].into_iter().collect(),
                vec![(make_alert_event(), true), (make_worker_event("w1"), false)],
            ),
            (
                [SubscriptionTopic::MetricsSummary].into_iter().collect(),
                vec![(make_metrics_event(), true), (make_task_event("t1", "n", "q", "w"), false)],
            ),
        ];

        for (i, (subs, events)) in cases.iter().enumerate() {
            for (j, (event, expected)) in events.iter().enumerate() {
                assert_eq!(
                    matches_any_subscription(event, subs), *expected,
                    "case {i} event {j} failed"
                );
            }
        }
    }

    #[test]
    fn empty_subscriptions_matches_nothing() {
        let subs: HashSet<SubscriptionTopic> = HashSet::new();
        assert!(!matches_any_subscription(&make_task_event("t1", "n", "q", "w"), &subs));
        assert!(!matches_any_subscription(&make_worker_event("w1"), &subs));
        assert!(!matches_any_subscription(&make_beat_event(), &subs));
        assert!(!matches_any_subscription(&make_alert_event(), &subs));
        assert!(!matches_any_subscription(&make_metrics_event(), &subs));
    }

    #[test]
    fn multiple_subscriptions_match_if_any_matches() {
        let subs: HashSet<_> = [
            SubscriptionTopic::Queue { queue: "emails".into() },
            SubscriptionTopic::AllWorkers,
            SubscriptionTopic::Alerts,
        ].into_iter().collect();

        assert!(matches_any_subscription(&make_task_event("t1", "tasks.send_email", "emails", "w1"), &subs));
        assert!(!matches_any_subscription(&make_task_event("t2", "tasks.add", "default", "w1"), &subs));
        assert!(matches_any_subscription(&make_worker_event("w1"), &subs));
        assert!(matches_any_subscription(&make_alert_event(), &subs));
        assert!(!matches_any_subscription(&make_beat_event(), &subs));
        assert!(!matches_any_subscription(&make_metrics_event(), &subs));
    }

    #[test]
    fn default_subscriptions_match_expected_events() {
        let subs: HashSet<_> = [
            SubscriptionTopic::AllTasks, SubscriptionTopic::AllWorkers,
            SubscriptionTopic::Alerts, SubscriptionTopic::MetricsSummary,
        ].into_iter().collect();

        assert!(matches_any_subscription(&make_task_event("t1", "n", "q", "w"), &subs));
        assert!(matches_any_subscription(&make_worker_event("w1"), &subs));
        assert!(matches_any_subscription(&make_alert_event(), &subs));
        assert!(matches_any_subscription(&make_metrics_event(), &subs));
        assert!(!matches_any_subscription(&make_beat_event(), &subs));
    }
}
