use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

/// Unified application error type.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Rate limited")]
    RateLimited,

    #[error("Tenant not found")]
    TenantNotFound,

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Validation error: {0}")]
    Validation(String),
}

#[derive(Serialize)]
struct ErrorResponse {
    error: ErrorBody,
}

#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

impl AppError {
    fn status_code(&self) -> StatusCode {
        match self {
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::BadRequest(_) | AppError::Validation(_) => StatusCode::BAD_REQUEST,
            AppError::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            AppError::Forbidden(_) => StatusCode::FORBIDDEN,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            AppError::TenantNotFound => StatusCode::NOT_FOUND,
            AppError::Internal(_) | AppError::Database(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn error_code(&self) -> &'static str {
        match self {
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::BadRequest(_) => "BAD_REQUEST",
            AppError::Unauthorized(_) => "UNAUTHORIZED",
            AppError::Forbidden(_) => "FORBIDDEN",
            AppError::Conflict(_) => "CONFLICT",
            AppError::RateLimited => "RATE_LIMITED",
            AppError::TenantNotFound => "TENANT_NOT_FOUND",
            AppError::Internal(_) => "INTERNAL_ERROR",
            AppError::Database(_) => "DATABASE_ERROR",
            AppError::Validation(_) => "VALIDATION_ERROR",
        }
    }
}

impl AppError {
    /// User-facing message without the error category prefix.
    fn user_message(&self) -> String {
        match self {
            AppError::NotFound(m)
            | AppError::BadRequest(m)
            | AppError::Unauthorized(m)
            | AppError::Forbidden(m)
            | AppError::Conflict(m)
            | AppError::Internal(m)
            | AppError::Database(m)
            | AppError::Validation(m) => m.clone(),
            AppError::RateLimited => "Too many requests".into(),
            AppError::TenantNotFound => "Tenant not found".into(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let body = ErrorResponse {
            error: ErrorBody {
                code: self.error_code(),
                message: self.user_message(),
            },
        };
        (status, axum::Json(body)).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        match &e {
            sqlx::Error::RowNotFound => AppError::NotFound("Resource not found".into()),
            sqlx::Error::Database(db_err) => {
                let msg = db_err.message();
                if msg.contains("unique constraint") {
                    // Extract a user-friendly constraint name
                    if msg.contains("tenants_slug_key") {
                        AppError::Conflict("An organization with this slug already exists".into())
                    } else if msg.contains("users_tenant_id_email_key") {
                        AppError::Conflict("A user with this email already exists".into())
                    } else {
                        AppError::Conflict("A record with this value already exists".into())
                    }
                } else {
                    AppError::Database(e.to_string())
                }
            }
            _ => AppError::Database(e.to_string()),
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::BadRequest(format!("JSON error: {e}"))
    }
}

impl From<jsonwebtoken::errors::Error> for AppError {
    fn from(e: jsonwebtoken::errors::Error) -> Self {
        AppError::Unauthorized(format!("Token error: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_and_status_codes_all_variants() {
        let cases: Vec<(AppError, &str, StatusCode, &str)> = vec![
            (AppError::NotFound("user 123".into()), "Not found: user 123", StatusCode::NOT_FOUND, "NOT_FOUND"),
            (AppError::BadRequest("invalid".into()), "Bad request: invalid", StatusCode::BAD_REQUEST, "BAD_REQUEST"),
            (AppError::Unauthorized("expired".into()), "Unauthorized: expired", StatusCode::UNAUTHORIZED, "UNAUTHORIZED"),
            (AppError::Forbidden("denied".into()), "Forbidden: denied", StatusCode::FORBIDDEN, "FORBIDDEN"),
            (AppError::Conflict("dup".into()), "Conflict: dup", StatusCode::CONFLICT, "CONFLICT"),
            (AppError::RateLimited, "Rate limited", StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED"),
            (AppError::TenantNotFound, "Tenant not found", StatusCode::NOT_FOUND, "TENANT_NOT_FOUND"),
            (AppError::Internal("panic".into()), "Internal error: panic", StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR"),
            (AppError::Database("conn".into()), "Database error: conn", StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
            (AppError::Validation("name".into()), "Validation error: name", StatusCode::BAD_REQUEST, "VALIDATION_ERROR"),
        ];

        for (err, display, status, code) in cases {
            assert_eq!(err.to_string(), display, "display mismatch for {code}");
            assert_eq!(err.status_code(), status, "status mismatch for {code}");
            assert_eq!(err.error_code(), code);
        }
    }

    #[test]
    fn from_serde_json_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("invalid json").unwrap_err();
        let app_err: AppError = json_err.into();
        match &app_err {
            AppError::BadRequest(msg) => assert!(msg.starts_with("JSON error:")),
            other => panic!("Expected BadRequest, got: {:?}", other),
        }
    }
}
