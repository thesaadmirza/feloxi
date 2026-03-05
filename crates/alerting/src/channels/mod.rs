pub mod email;
pub mod pagerduty;
pub mod slack;
pub mod webhook;

/// Result of sending an alert notification.
#[derive(Debug)]
pub struct SendResult {
    pub channel_type: String,
    pub success: bool,
    pub error: Option<String>,
}

impl SendResult {
    pub fn ok(channel_type: &str) -> Self {
        Self { channel_type: channel_type.to_string(), success: true, error: None }
    }

    pub fn err(channel_type: &str, error: impl std::fmt::Display) -> Self {
        Self {
            channel_type: channel_type.to_string(),
            success: false,
            error: Some(error.to_string()),
        }
    }
}
