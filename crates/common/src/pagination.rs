use serde::{Deserialize, Serialize};

/// Cursor-based pagination parameters.
#[derive(Debug, Clone, Deserialize)]
pub struct CursorParams {
    pub cursor: Option<String>,
    pub limit: Option<i64>,
    #[serde(default)]
    pub direction: SortDirection,
}

impl CursorParams {
    pub fn limit_or_default(&self) -> i64 {
        self.limit.unwrap_or(50).min(200).max(1)
    }
}

/// Offset-based pagination parameters (fallback).
#[derive(Debug, Clone, Deserialize)]
pub struct OffsetParams {
    pub offset: Option<i64>,
    pub limit: Option<i64>,
}

impl OffsetParams {
    pub fn offset_or_default(&self) -> i64 {
        self.offset.unwrap_or(0).max(0)
    }

    pub fn limit_or_default(&self) -> i64 {
        self.limit.unwrap_or(50).min(200).max(1)
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    Asc,
    #[default]
    Desc,
}

/// Paginated response wrapper.
#[derive(Debug, Clone, Serialize)]
pub struct PaginatedResponse<T: Serialize> {
    pub data: Vec<T>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
    pub total: Option<i64>,
}

impl<T: Serialize> PaginatedResponse<T> {
    pub fn new(data: Vec<T>, next_cursor: Option<String>, total: Option<i64>) -> Self {
        let has_more = next_cursor.is_some();
        Self {
            data,
            next_cursor,
            has_more,
            total,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_limit_clamping() {
        let cases: Vec<(Option<i64>, i64)> = vec![
            (None, 50), (Some(25), 25), (Some(500), 200),
            (Some(0), 1), (Some(-10), 1), (Some(200), 200), (Some(1), 1),
        ];
        for (input, expected) in cases {
            let p = CursorParams { cursor: None, limit: input, direction: SortDirection::Desc };
            assert_eq!(p.limit_or_default(), expected, "limit={input:?}");
        }
    }

    #[test]
    fn offset_params_clamping() {
        let p = OffsetParams { offset: None, limit: None };
        assert_eq!(p.offset_or_default(), 0);
        assert_eq!(p.limit_or_default(), 50);

        let p = OffsetParams { offset: Some(-5), limit: Some(1000) };
        assert_eq!(p.offset_or_default(), 0);
        assert_eq!(p.limit_or_default(), 200);
    }

    #[test]
    fn paginated_response_behavior() {
        let with_cursor = PaginatedResponse::new(vec![1, 2, 3], Some("c".into()), Some(100));
        assert!(with_cursor.has_more);
        assert_eq!(with_cursor.next_cursor, Some("c".to_string()));

        let without = PaginatedResponse::<i32>::new(vec![], None, Some(0));
        assert!(!without.has_more);
        assert!(without.data.is_empty());

        // serialization
        let json = serde_json::to_value(&with_cursor).unwrap();
        assert_eq!(json["has_more"], true);
        assert_eq!(json["data"].as_array().unwrap().len(), 3);
    }
}
