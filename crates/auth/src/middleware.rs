use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use uuid::Uuid;

use crate::jwt::{verify_access_token, Claims, JwtKeys};

/// Authenticated user extracted from JWT.
#[derive(Debug, Clone)]
pub struct CurrentUser {
    pub user_id: Uuid,
    pub tenant_id: Uuid,
    pub email: String,
    pub roles: Vec<String>,
    pub permissions: Vec<String>,
}

impl From<Claims> for CurrentUser {
    fn from(claims: Claims) -> Self {
        Self {
            user_id: claims.sub,
            tenant_id: claims.tid,
            email: claims.email,
            roles: claims.roles,
            permissions: claims.permissions,
        }
    }
}

impl CurrentUser {
    pub fn has_permission(&self, perm: &str) -> bool {
        self.permissions.iter().any(|p| p == perm)
    }

    pub fn is_admin(&self) -> bool {
        self.roles.iter().any(|r| r == "admin")
    }
}

/// Extract Bearer token from Authorization header.
fn extract_bearer_token(req: &Request) -> Option<&str> {
    req.headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

/// Extract access token from the fp_access HttpOnly cookie.
fn extract_cookie_token(req: &Request) -> Option<String> {
    req.headers()
        .get_all("cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|s| s.split(';'))
        .map(|s| s.trim())
        .find(|s| s.starts_with("fp_access="))
        .map(|s| s.trim_start_matches("fp_access=").to_string())
}

/// JWT authentication middleware.
/// Checks Authorization header first, then falls back to fp_access cookie.
pub async fn auth_middleware(
    State(jwt_keys): State<JwtKeys>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let token: String = if let Some(bearer) = extract_bearer_token(&req) {
        bearer.to_string()
    } else if let Some(cookie_token) = extract_cookie_token(&req) {
        cookie_token
    } else {
        return Err(StatusCode::UNAUTHORIZED);
    };

    let claims = verify_access_token(&jwt_keys, &token).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let user = CurrentUser::from(claims);
    req.extensions_mut().insert(user);

    Ok(next.run(req).await)
}

/// Require admin role middleware (must be applied after auth_middleware).
pub async fn require_admin(req: Request, next: Next) -> Result<Response, StatusCode> {
    let user = req.extensions().get::<CurrentUser>().ok_or(StatusCode::UNAUTHORIZED)?;

    if !user.is_admin() {
        return Err(StatusCode::FORBIDDEN);
    }

    Ok(next.run(req).await)
}

/// Require a specific permission (must be applied after auth_middleware).
pub fn require_permission(
    permission: &'static str,
) -> impl Fn(
    Request,
    Next,
) -> std::pin::Pin<
    Box<dyn std::future::Future<Output = Result<Response, StatusCode>> + Send>,
> + Clone {
    move |req: Request, next: Next| {
        Box::pin(async move {
            let user = req.extensions().get::<CurrentUser>().ok_or(StatusCode::UNAUTHORIZED)?;

            if !user.has_permission(permission) {
                return Err(StatusCode::FORBIDDEN);
            }

            Ok(next.run(req).await)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_bearer_token_valid() {
        let req = Request::builder()
            .header("authorization", "Bearer my-jwt-token-here")
            .body(axum::body::Body::empty())
            .unwrap();

        let token = extract_bearer_token(&req);
        assert_eq!(token, Some("my-jwt-token-here"));
    }

    #[test]
    fn test_extract_bearer_token_missing_header() {
        let req = Request::builder().body(axum::body::Body::empty()).unwrap();

        let token = extract_bearer_token(&req);
        assert_eq!(token, None);
    }

    #[test]
    fn test_extract_bearer_token_wrong_scheme() {
        let req = Request::builder()
            .header("authorization", "Basic dXNlcjpwYXNz")
            .body(axum::body::Body::empty())
            .unwrap();

        let token = extract_bearer_token(&req);
        assert_eq!(token, None);
    }

    #[test]
    fn test_extract_bearer_token_no_space_after_bearer() {
        let req = Request::builder()
            .header("authorization", "Bearertoken")
            .body(axum::body::Body::empty())
            .unwrap();

        let token = extract_bearer_token(&req);
        assert_eq!(token, None);
    }

    #[test]
    fn test_extract_bearer_token_empty_value() {
        let req = Request::builder()
            .header("authorization", "Bearer ")
            .body(axum::body::Body::empty())
            .unwrap();

        let token = extract_bearer_token(&req);
        assert_eq!(token, Some(""));
    }

    #[test]
    fn test_extract_bearer_token_case_sensitive() {
        let req = Request::builder()
            .header("authorization", "bearer my-token")
            .body(axum::body::Body::empty())
            .unwrap();

        // strip_prefix("Bearer ") is case sensitive
        let token = extract_bearer_token(&req);
        assert_eq!(token, None, "Bearer prefix should be case sensitive");
    }
}
