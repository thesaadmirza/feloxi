use reqwest::Client;
use std::collections::HashMap;

use super::SendResult;
use crate::engine::FiredAlert;

pub async fn send_webhook_alert(
    client: &Client,
    url: &str,
    headers: &Option<HashMap<String, String>>,
    alert: &FiredAlert,
) -> SendResult {
    let mut req = client.post(url).json(alert);

    if let Some(hdrs) = headers {
        for (key, value) in hdrs {
            req = req.header(key.as_str(), value.as_str());
        }
    }

    match req.send().await {
        Ok(resp) if resp.status().is_success() => SendResult::ok("webhook"),
        Ok(resp) => SendResult::err("webhook", format!("HTTP {}", resp.status())),
        Err(e) => SendResult::err("webhook", e),
    }
}
