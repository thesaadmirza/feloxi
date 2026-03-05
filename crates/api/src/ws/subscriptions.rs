use serde::{Deserialize, Serialize};

/// Topics that a dashboard client can subscribe to.
#[derive(Debug, Clone, Hash, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SubscriptionTopic {
    AllTasks,
    Queue { queue: String },
    Task { task_id: String },
    TaskType { task_name: String },
    AllWorkers,
    Worker { worker_id: String },
    Beat,
    Alerts,
    MetricsSummary,
}

/// Commands from the dashboard client.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsClientCommand {
    Subscribe { topics: Vec<SubscriptionTopic> },
    Unsubscribe { topics: Vec<SubscriptionTopic> },
    Ping,
}

/// Messages sent to the dashboard client.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsServerMessage {
    Pong,
    Subscribed { topics: Vec<SubscriptionTopic> },
    Event { payload: serde_json::Value },
    Error { message: String },
}

