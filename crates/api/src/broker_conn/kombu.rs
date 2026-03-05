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

    let content_type =
        envelope.get("content-type").and_then(|v| v.as_str()).unwrap_or("application/json");

    let content_encoding =
        envelope.get("content-encoding").and_then(|v| v.as_str()).unwrap_or("utf-8");

    // Celery's Redis transport uses properties.body_encoding instead of content-encoding
    let body_encoding =
        envelope.get("properties").and_then(|p| p.get("body_encoding")).and_then(|v| v.as_str());

    let is_base64 = content_encoding == "base64" || body_encoding == Some("base64");

    let decoded_bytes =
        if is_base64 { STANDARD.decode(body_str).ok()? } else { body_str.as_bytes().to_vec() };

    if content_type == "application/json" {
        serde_json::from_slice(&decoded_bytes).ok()
    } else {
        None
    }
}

fn extract_type_from_body(body: &serde_json::Value) -> Option<String> {
    // Single event object
    if let Some(t) = body.get("type").and_then(|v| v.as_str()) {
        return Some(t.to_string());
    }
    // Array of events (task.multi) — use first element's type
    if let Some(arr) = body.as_array() {
        for item in arr {
            let item_val = if let Some(s) = item.as_str() {
                serde_json::from_str::<serde_json::Value>(s).ok()
            } else {
                Some(item.clone())
            };
            if let Some(v) = item_val {
                if let Some(t) = v.get("type").and_then(|v| v.as_str()) {
                    return Some(t.to_string());
                }
            }
        }
    }
    None
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

    // Try body's "type" field (plain JSON or base64-encoded)
    if let Some(body_str) = val.get("body").and_then(|v| v.as_str()) {
        // Try plain JSON first
        if let Ok(body) = serde_json::from_str::<serde_json::Value>(body_str) {
            if let Some(t) = extract_type_from_body(&body) {
                return Some(t);
            }
        }
        // Try base64 decode (Celery Redis transport uses properties.body_encoding: "base64")
        if let Ok(decoded) = STANDARD.decode(body_str) {
            if let Ok(body) = serde_json::from_slice::<serde_json::Value>(&decoded) {
                if let Some(t) = extract_type_from_body(&body) {
                    return Some(t);
                }
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
    fn decode_base64_body_via_properties() {
        // Celery Redis transport: content-encoding is "utf-8" but
        // properties.body_encoding is "base64"
        let json_body = r#"[{"type": "task-succeeded", "uuid": "abc123", "runtime": 0.65, "hostname": "celery@worker1"}]"#;
        let encoded = STANDARD.encode(json_body);
        let envelope = serde_json::json!({
            "body": encoded,
            "content-type": "application/json",
            "content-encoding": "utf-8",
            "headers": {},
            "properties": {
                "body_encoding": "base64",
                "delivery_info": {"routing_key": "task.multi"}
            }
        })
        .to_string();

        let body = decode_kombu_body(&envelope).unwrap();
        let arr = body.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["type"], "task-succeeded");
        assert_eq!(arr[0]["uuid"], "abc123");
    }

    #[test]
    fn extract_event_type_from_base64_body() {
        let json_body =
            r#"[{"type": "task-received", "uuid": "def456", "hostname": "celery@worker1"}]"#;
        let encoded = STANDARD.encode(json_body);
        let envelope = serde_json::json!({
            "body": encoded,
            "content-type": "application/json",
            "content-encoding": "utf-8",
            "properties": {"body_encoding": "base64"}
        })
        .to_string();

        let et = extract_event_type(&envelope).unwrap();
        assert_eq!(et, "task-received");
    }

    #[test]
    fn extract_type_from_body_array() {
        let body: serde_json::Value = serde_json::from_str(
            r#"[{"type": "worker-online", "hostname": "celery@w1"}, {"type": "worker-heartbeat"}]"#,
        )
        .unwrap();
        let t = extract_type_from_body(&body).unwrap();
        assert_eq!(t, "worker-online");
    }

    #[test]
    fn invalid_json_returns_none() {
        assert!(decode_kombu_body("not json").is_none());
    }
}
