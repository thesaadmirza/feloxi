pub mod discord;
pub mod email;
pub mod pagerduty;
pub mod slack;
pub mod slack_bot;
pub mod webhook;

use uuid::Uuid;

/// Result of sending an alert notification.
#[derive(Debug, Clone)]
pub struct SendResult {
    pub channel_type: String,
    pub success: bool,
    pub error: Option<String>,
    /// HTTP status returned by the provider, when applicable. Drives revocation
    /// detection (e.g. Discord 404, Slack `account_inactive`).
    pub status: Option<u16>,
    /// Provider-requested wait before retrying (seconds), parsed from a 429
    /// `Retry-After` header or `retry_after` body field. A present value means
    /// "rate limited" — reschedule without counting against the retry cap.
    pub retry_after: Option<f64>,
    /// The integration this delivery used, when the channel references one.
    /// Required so the dispatch log / retry queue can key per-integration
    /// instead of per-channel-type (two integrations of the same kind on one
    /// rule must not collide).
    pub integration_id: Option<Uuid>,
}

impl SendResult {
    pub fn ok(channel_type: &str) -> Self {
        Self {
            channel_type: channel_type.to_string(),
            success: true,
            error: None,
            status: None,
            retry_after: None,
            integration_id: None,
        }
    }

    pub fn err(channel_type: &str, error: impl std::fmt::Display) -> Self {
        Self {
            channel_type: channel_type.to_string(),
            success: false,
            error: Some(error.to_string()),
            status: None,
            retry_after: None,
            integration_id: None,
        }
    }

    /// Record the provider HTTP status.
    pub fn with_status(mut self, status: u16) -> Self {
        self.status = Some(status);
        self
    }

    /// Record a rate-limit backoff hint (seconds).
    pub fn with_retry_after(mut self, retry_after: f64) -> Self {
        self.retry_after = Some(retry_after);
        self
    }

    /// Tag the delivery with the integration it used.
    pub fn with_integration_id(mut self, integration_id: Uuid) -> Self {
        self.integration_id = Some(integration_id);
        self
    }

    /// Stable key for the delivery log / retry queue: `type:integration_id`
    /// when an integration is referenced, else just the channel type (legacy
    /// inline channels). Prevents same-kind integrations from overwriting each
    /// other's status.
    pub fn delivery_key(&self) -> String {
        match self.integration_id {
            Some(id) => format!("{}:{}", self.channel_type, id),
            None => self.channel_type.clone(),
        }
    }
}
