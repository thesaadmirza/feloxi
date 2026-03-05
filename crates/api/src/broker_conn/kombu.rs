use base64::{engine::general_purpose::STANDARD, Engine};

/// Decode a Kombu message envelope.
///
/// Kombu (used by Celery on Redis) wraps messages in a JSON envelope:
/// ```json
/// {
///   "body": "<json-or-base64-encoded>",
///   "content-type": "application/json",
///   "content-encoding": "utf-8",
///   "headers": { ... },
///   "properties": { ... }
/// }
/// ```
///
/// The body may be a JSON string (if content-encoding is utf-8 and content-type
/// is application/json) or base64-encoded.
pub fn decode_kombu_body(raw: &str) -> Option<serde_json::Value> {
    // Try to parse the whole thing as a Kombu envelope
    let envelope: serde_json::Value = serde_json::from_str(raw).ok()?;

    let body_val = envelope.get("body")?;
    let body_str = body_val.as_str()?;

    let content_type = envelope
        .get("content-type")
        .and_then(|v| v.as_str())
        .unwrap_or("application/json");

    let content_encoding = envelope
        .get("content-encoding")
        .and_then(|v| v.as_str())
        .unwrap_or("utf-8");

    let decoded_bytes = if content_encoding == "base64" {
        STANDARD.decode(body_str).ok()?
    } else {
        body_str.as_bytes().to_vec()
    };

    if content_type == "application/json" {
        serde_json::from_slice(&decoded_bytes).ok()
    } else {
        None
    }
}

/// Extract the event type from a Kombu message.
///
/// Celery events carry the event type in `headers.task` or in the body's `type` field.
/// The routing key also encodes the event type (e.g., `task.received`).
pub fn extract_event_type(envelope: &str) -> Option<String> {
    let val: serde_json::Value = serde_json::from_str(envelope).ok()?;

    // Try headers first
    if let Some(headers) = val.get("headers") {
        if let Some(t) = headers.get("task").and_then(|v| v.as_str()) {
            return Some(t.to_string());
        }
    }

    // Try body's "type" field
    if let Some(body_str) = val.get("body").and_then(|v| v.as_str()) {
        if let Ok(body) = serde_json::from_str::<serde_json::Value>(body_str) {
            if let Some(t) = body.get("type").and_then(|v| v.as_str()) {
                return Some(t.to_string());
            }
        }
    }

    // Try properties.delivery_info.routing_key
    if let Some(props) = val.get("properties") {
        if let Some(di) = props.get("delivery_info") {
            if let Some(rk) = di.get("routing_key").and_then(|v| v.as_str()) {
                return Some(rk.replace('.', "-"));
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_utf8_json_body() {
        let envelope = r#"{
            "body": "{\"uuid\": \"abc\", \"timestamp\": 1700000000.0, \"type\": \"task-received\"}",
            "content-type": "application/json",
            "content-encoding": "utf-8"
        }"#;

        let body = decode_kombu_body(envelope).unwrap();
        assert_eq!(body["uuid"], "abc");
        assert_eq!(body["type"], "task-received");
    }

    #[test]
    fn decode_base64_body() {
        let json_body = r#"{"uuid": "xyz", "timestamp": 1700000001.0}"#;
        let encoded = STANDARD.encode(json_body);
        let envelope = format!(
            r#"{{"body": "{}", "content-type": "application/json", "content-encoding": "base64"}}"#,
            encoded
        );

        let body = decode_kombu_body(&envelope).unwrap();
        assert_eq!(body["uuid"], "xyz");
    }

    #[test]
    fn extract_event_type_from_body() {
        let envelope = r#"{
            "body": "{\"type\": \"task-succeeded\", \"uuid\": \"abc\", \"timestamp\": 1.0}",
            "content-type": "application/json",
            "content-encoding": "utf-8"
        }"#;

        let et = extract_event_type(envelope).unwrap();
        assert_eq!(et, "task-succeeded");
    }

    #[test]
    fn invalid_json_returns_none() {
        assert!(decode_kombu_body("not json").is_none());
    }
}
