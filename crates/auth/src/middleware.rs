use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use uuid::Uuid;

use crate::jwt::{verify_access_token, Claims, JwtKeys};

/// What the auth middleware needs: JWT keys for sessions, Postgres for API keys.
#[derive(Clone)]
pub struct AuthState {
    pub jwt_keys: JwtKeys,
    pub pg: sqlx::PgPool,
}

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

/// Authentication middleware.
///
/// Accepts a session JWT (Authorization header, then the fp_access cookie) or
/// an API key (`Authorization: Bearer fp_key_...`).
pub async fn auth_middleware(
    State(auth): State<AuthState>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let user = match extract_bearer_token(&req) {
        Some(bearer) if bearer.starts_with(crate::api_key::KEY_PREFIX) => {
            authenticate_api_key(&auth.pg, bearer).await?
        }
        Some(bearer) => session_user(&auth.jwt_keys, bearer)?,
        None => {
            let token = extract_cookie_token(&req).ok_or(StatusCode::UNAUTHORIZED)?;
            session_user(&auth.jwt_keys, &token)?
        }
    };
    req.extensions_mut().insert(user);

    Ok(next.run(req).await)
}

fn session_user(jwt_keys: &JwtKeys, token: &str) -> Result<CurrentUser, StatusCode> {
    let claims = verify_access_token(jwt_keys, token).map_err(|_| StatusCode::UNAUTHORIZED)?;
    Ok(CurrentUser::from(claims))
}

/// Resolve an API key to the user who created it, limited to the key's scopes.
/// Revoked or expired keys, and keys whose creator was deactivated, are refused.
async fn authenticate_api_key(pg: &sqlx::PgPool, raw: &str) -> Result<CurrentUser, StatusCode> {
    let prefix = crate::api_key::extract_prefix(raw).ok_or(StatusCode::UNAUTHORIZED)?;
    let key = db::postgres::api_keys::get_api_key_by_prefix(pg, prefix)
        .await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    if !crate::api_key::verify_api_key(raw, &key.key_hash) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    if key.expires_at.is_some_and(|at| at <= chrono::Utc::now()) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let creator = db::postgres::users::get_user_by_id(pg, key.created_by)
        .await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    if creator.tenant_id != key.tenant_id {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let roles = db::postgres::rbac::get_user_roles(pg, creator.id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let creator_is_admin = roles.iter().any(|r| r.name == "admin");
    let creator_permissions: Vec<String> =
        roles.iter().flat_map(|r| r.permissions.0.iter().cloned()).collect();

    let pool = pg.clone();
    tokio::spawn(async move {
        let _ = db::postgres::api_keys::update_last_used(&pool, key.id).await;
    });

    Ok(CurrentUser {
        user_id: creator.id,
        tenant_id: key.tenant_id,
        email: creator.email,
        // Never the admin role: a key is exactly its scopes.
        roles: Vec::new(),
        permissions: crate::rbac::api_key_permissions(
            &key.permissions.0,
            &creator_permissions,
            creator_is_admin,
        ),
    })
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
