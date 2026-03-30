use axum::{
    extract::State,
    http::header::{HeaderMap, SET_COOKIE},
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::state::AppState;
use common::AppError;

fn is_secure_context() -> bool {
    std::env::var("CORS_ORIGIN")
        .map(|v| v.contains("https://"))
        .unwrap_or(false)
}

/// Build Set-Cookie headers for access + refresh tokens (HttpOnly, SameSite=Lax).
fn auth_cookies(access_token: &str, refresh_token: &str) -> HeaderMap {
    let secure = if is_secure_context() { "; Secure" } else { "" };
    let mut headers = HeaderMap::new();

    let access_cookie = format!(
        "fp_access={}; HttpOnly; Path=/; Max-Age=900; SameSite=Lax{}",
        access_token, secure
    );
    headers.append(
        SET_COOKIE,
        access_cookie.parse().expect("access token cookie is a valid HeaderValue"),
    );

    let refresh_cookie = format!(
        "fp_refresh={}; HttpOnly; Path=/api/v1/auth; Max-Age=2592000; SameSite=Lax{}",
        refresh_token, secure
    );
    headers.append(
        SET_COOKIE,
        refresh_cookie.parse().expect("refresh token cookie is a valid HeaderValue"),
    );

    headers
}

/// Build Set-Cookie headers that clear auth cookies (for logout).
fn clear_auth_cookies() -> HeaderMap {
    let secure = if is_secure_context() { "; Secure" } else { "" };
    let mut headers = HeaderMap::new();
    let access = format!("fp_access=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax{secure}");
    headers.append(SET_COOKIE, access.parse().expect("clear-access cookie is valid"));
    let refresh = format!(
        "fp_refresh=; HttpOnly; Path=/api/v1/auth; Max-Age=0; SameSite=Lax{secure}"
    );
    headers.append(SET_COOKIE, refresh.parse().expect("clear-refresh cookie is valid"));
    headers
}

#[derive(Deserialize, ToSchema)]
pub struct RegisterRequest {
    pub tenant_name: String,
    pub tenant_slug: String,
    pub email: String,
    pub password: String,
    pub display_name: Option<String>,
}

#[derive(Deserialize, ToSchema)]
pub struct LoginRequest {
    /// Optional: if the user belongs to multiple orgs, they must specify which one.
    pub tenant_slug: Option<String>,
    pub email: String,
    pub password: String,
}

/// Successful auth response. Tokens are set as HttpOnly cookies, NOT in the body.
#[derive(Serialize, ToSchema)]
pub struct AuthResponse {
    pub user: UserInfo,
    pub expires_in: i64,
}

#[derive(Serialize, Clone, ToSchema)]
pub struct UserInfo {
    pub id: uuid::Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub tenant_id: uuid::Uuid,
    pub tenant_slug: String,
    pub roles: Vec<String>,
}

/// Returned when the user's email is in multiple orgs and no slug was provided.
#[derive(Serialize, ToSchema)]
pub struct OrgPickerResponse {
    pub needs_org_selection: bool,
    pub organizations: Vec<OrgSummary>,
}

#[derive(Serialize, ToSchema)]
pub struct OrgSummary {
    pub slug: String,
    pub name: String,
}

#[utoipa::path(post, path = "/api/v1/auth/register", tag = "auth",
    request_body = RegisterRequest,
    responses((status = 200, body = AuthResponse), (status = 400, description = "Validation error"))
)]
pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> Result<(HeaderMap, Json<AuthResponse>), AppError> {
    if req.password.len() < 8 {
        return Err(AppError::Validation("Password must be at least 8 characters".into()));
    }

    let has_tenants = db::postgres::tenants::has_tenants(&state.pg).await?;
    if has_tenants && !state.config.allow_signup {
        return Err(AppError::Forbidden("Public signup is disabled".into()));
    }

    let tenant = db::postgres::tenants::create_tenant(
        &state.pg,
        &db::postgres::models::CreateTenant {
            name: req.tenant_name,
            slug: req.tenant_slug.clone(),
            plan: None,
        },
    )
    .await?;

    db::postgres::rbac::init_system_roles(&state.pg, tenant.id).await?;

    let password_hash = auth::password::hash_password(&req.password)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let user = db::postgres::users::create_user(
        &state.pg,
        &db::postgres::models::CreateUser {
            tenant_id: tenant.id,
            email: req.email,
            password_hash,
            display_name: req.display_name,
        },
    )
    .await?;

    let admin_role = db::postgres::rbac::get_role_by_name(&state.pg, tenant.id, "admin").await?;
    db::postgres::rbac::assign_role(&state.pg, user.id, admin_role.id).await?;

    let permissions = db::postgres::rbac::get_user_permissions(&state.pg, user.id).await?;

    let access_token = auth::jwt::issue_access_token(
        &state.jwt_keys,
        user.id,
        tenant.id,
        &user.email,
        vec!["admin".to_string()],
        permissions,
    )
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let refresh_token = auth::jwt::generate_refresh_token();
    let refresh_hash = auth::jwt::hash_refresh_token(&refresh_token);
    let refresh_expires = chrono::Utc::now() + chrono::Duration::days(30);
    db::postgres::refresh_tokens::create_refresh_token(
        &state.pg,
        user.id,
        tenant.id,
        &refresh_hash,
        refresh_expires,
    )
    .await?;

    let cookies = auth_cookies(&access_token, &refresh_token);

    Ok((
        cookies,
        Json(AuthResponse {
            expires_in: 900,
            user: UserInfo {
                id: user.id,
                email: user.email,
                display_name: user.display_name,
                tenant_id: tenant.id,
                tenant_slug: req.tenant_slug,
                roles: vec!["admin".to_string()],
            },
        }),
    ))
}

#[utoipa::path(post, path = "/api/v1/auth/login", tag = "auth",
    request_body = LoginRequest,
    responses((status = 200, body = AuthResponse), (status = 200, body = OrgPickerResponse, description = "Org selection needed"), (status = 401, description = "Invalid credentials"))
)]
pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<axum::response::Response, AppError> {
    let resolved = if let Some(slug) = &req.tenant_slug {
        if slug.is_empty() {
            resolve_user_by_email(&state, &req.email).await?
        } else {
            let t = db::postgres::tenants::get_tenant_by_slug(&state.pg, slug)
                .await
                .map_err(|_| AppError::Unauthorized("Invalid credentials".into()))?;
            let u = db::postgres::users::get_user_by_email(&state.pg, t.id, &req.email)
                .await
                .map_err(|_| AppError::Unauthorized("Invalid credentials".into()))?;
            ResolveResult::Single(Box::new((t, u)))
        }
    } else {
        resolve_user_by_email(&state, &req.email).await?
    };

    let (tenant, user) = match resolved {
        ResolveResult::Single(pair) => {
            let (t, u) = *pair;
            (t, u)
        }
        ResolveResult::Multiple(orgs) => {
            let body = OrgPickerResponse { needs_org_selection: true, organizations: orgs };
            return Ok(axum::response::IntoResponse::into_response(Json(body)));
        }
    };

    let valid = auth::password::verify_password(&req.password, &user.password_hash)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if !valid {
        return Err(AppError::Unauthorized("Invalid credentials".into()));
    }

    let roles = db::postgres::rbac::get_user_roles(&state.pg, user.id).await?;
    let role_names: Vec<String> = roles.iter().map(|r| r.name.clone()).collect();
    let permissions = db::postgres::rbac::get_user_permissions(&state.pg, user.id).await?;

    let access_token = auth::jwt::issue_access_token(
        &state.jwt_keys,
        user.id,
        tenant.id,
        &user.email,
        role_names.clone(),
        permissions,
    )
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let refresh_token = auth::jwt::generate_refresh_token();
    let refresh_hash = auth::jwt::hash_refresh_token(&refresh_token);
    let refresh_expires = chrono::Utc::now() + chrono::Duration::days(30);
    db::postgres::refresh_tokens::create_refresh_token(
        &state.pg,
        user.id,
        tenant.id,
        &refresh_hash,
        refresh_expires,
    )
    .await?;

    let cookies = auth_cookies(&access_token, &refresh_token);
    let body = AuthResponse {
        expires_in: 900,
        user: UserInfo {
            id: user.id,
            email: user.email,
            display_name: user.display_name,
            tenant_id: tenant.id,
            tenant_slug: tenant.slug,
            roles: role_names,
        },
    };

    Ok(axum::response::IntoResponse::into_response((cookies, Json(body))))
}

enum ResolveResult {
    Single(Box<(db::postgres::models::Tenant, db::postgres::models::User)>),
    Multiple(Vec<OrgSummary>),
}

/// Resolve user by email. If 1 org → return user+tenant. If multiple → return org list.
async fn resolve_user_by_email(state: &AppState, email: &str) -> Result<ResolveResult, AppError> {
    let users = db::postgres::users::find_users_by_email(&state.pg, email).await?;

    match users.len() {
        0 => Err(AppError::Unauthorized("Invalid credentials".into())),
        1 => {
            let user =
                users.into_iter().next().expect("len() == 1 guarantees at least one element");
            let tenant = db::postgres::tenants::get_tenant_by_id(&state.pg, user.tenant_id)
                .await
                .map_err(|_| AppError::Unauthorized("Invalid credentials".into()))?;
            Ok(ResolveResult::Single(Box::new((tenant, user))))
        }
        _ => {
            let mut orgs = Vec::new();
            for u in &users {
                if let Ok(t) = db::postgres::tenants::get_tenant_by_id(&state.pg, u.tenant_id).await
                {
                    orgs.push(OrgSummary { slug: t.slug, name: t.name });
                }
            }
            Ok(ResolveResult::Multiple(orgs))
        }
    }
}

/// Extract a named cookie value from headers.
fn extract_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let prefix = format!("{}=", name);
    headers
        .get_all("cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|s| s.split(';'))
        .map(|s| s.trim())
        .find(|s| s.starts_with(&prefix))
        .map(|s| s[prefix.len()..].to_string())
}

/// Verify request from Bearer header or fp_access cookie. Returns JWT claims.
async fn verify_request(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<auth::jwt::Claims, AppError> {
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string())
        .or_else(|| extract_cookie(headers, "fp_access"))
        .ok_or_else(|| AppError::Unauthorized("Not authenticated".into()))?;
    auth::jwt::verify_access_token(&state.jwt_keys, &token)
        .map_err(|_| AppError::Unauthorized("Invalid token".into()))
}

#[utoipa::path(post, path = "/api/v1/auth/refresh", tag = "auth",
    responses((status = 200, body = AuthResponse), (status = 401, description = "Invalid refresh token"))
)]
pub async fn refresh(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<AuthResponse>), AppError> {
    let refresh_token_value = extract_cookie(&headers, "fp_refresh")
        .ok_or_else(|| AppError::Unauthorized("No refresh token".into()))?;

    let token_hash = auth::jwt::hash_refresh_token(&refresh_token_value);
    let stored = db::postgres::refresh_tokens::find_valid_refresh_token(&state.pg, &token_hash)
        .await
        .map_err(|_| AppError::Unauthorized("Invalid or expired refresh token".into()))?;

    db::postgres::refresh_tokens::revoke_refresh_token(&state.pg, stored.id).await?;

    let user = db::postgres::users::get_user_by_id(&state.pg, stored.user_id)
        .await
        .map_err(|_| AppError::Unauthorized("User not found".into()))?;
    let tenant = db::postgres::tenants::get_tenant_by_id(&state.pg, stored.tenant_id)
        .await
        .map_err(|_| AppError::Unauthorized("Tenant not found".into()))?;

    let roles = db::postgres::rbac::get_user_roles(&state.pg, user.id).await?;
    let role_names: Vec<String> = roles.iter().map(|r| r.name.clone()).collect();
    let permissions = db::postgres::rbac::get_user_permissions(&state.pg, user.id).await?;

    let access_token = auth::jwt::issue_access_token(
        &state.jwt_keys,
        user.id,
        tenant.id,
        &user.email,
        role_names.clone(),
        permissions,
    )
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let new_refresh_token = auth::jwt::generate_refresh_token();
    let new_hash = auth::jwt::hash_refresh_token(&new_refresh_token);
    let refresh_expires = chrono::Utc::now() + chrono::Duration::days(30);
    db::postgres::refresh_tokens::create_refresh_token(
        &state.pg,
        user.id,
        tenant.id,
        &new_hash,
        refresh_expires,
    )
    .await?;

    let cookies = auth_cookies(&access_token, &new_refresh_token);

    Ok((
        cookies,
        Json(AuthResponse {
            expires_in: 900,
            user: UserInfo {
                id: user.id,
                email: user.email,
                display_name: user.display_name,
                tenant_id: tenant.id,
                tenant_slug: tenant.slug,
                roles: role_names,
            },
        }),
    ))
}

#[utoipa::path(post, path = "/api/v1/auth/logout", tag = "auth",
    responses((status = 200, description = "Logged out"))
)]
pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> (HeaderMap, Json<serde_json::Value>) {
    // Best-effort: revoke refresh tokens if the user is authenticated
    if let Ok(claims) = verify_request(&state, &headers).await {
        let _ =
            db::postgres::refresh_tokens::revoke_all_for_user(&state.pg, claims.sub).await;
    }
    (clear_auth_cookies(), Json(serde_json::json!({ "ok": true })))
}

/// Return the current user info (used by frontend to check if session is active).
#[utoipa::path(get, path = "/api/v1/auth/me", tag = "auth",
    responses((status = 200, body = UserInfo), (status = 401, description = "Not authenticated"))
)]
pub async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<UserInfo>, AppError> {
    let claims = verify_request(&state, &headers).await?;

    let user = db::postgres::users::get_user_by_id(&state.pg, claims.sub)
        .await
        .map_err(|_| AppError::Unauthorized("User not found".into()))?;
    let tenant = db::postgres::tenants::get_tenant_by_id(&state.pg, claims.tid)
        .await
        .map_err(|_| AppError::Unauthorized("Tenant not found".into()))?;

    Ok(Json(UserInfo {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        tenant_id: tenant.id,
        tenant_slug: tenant.slug,
        roles: claims.roles,
    }))
}

/// List all orgs the current user belongs to (for org switcher).
#[utoipa::path(get, path = "/api/v1/auth/orgs", tag = "auth",
    responses((status = 200, body = Vec<OrgSummary>))
)]
pub async fn list_user_orgs(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<OrgSummary>>, AppError> {
    let claims = verify_request(&state, &headers).await?;

    let users = db::postgres::users::find_users_by_email(&state.pg, &claims.email).await?;
    let mut orgs = Vec::new();
    for u in &users {
        if let Ok(t) = db::postgres::tenants::get_tenant_by_id(&state.pg, u.tenant_id).await {
            orgs.push(OrgSummary { slug: t.slug, name: t.name });
        }
    }
    Ok(Json(orgs))
}

/// Switch to a different org (re-issues tokens for that org).
#[derive(Deserialize, ToSchema)]
pub struct SwitchOrgRequest {
    pub tenant_slug: String,
}

#[utoipa::path(post, path = "/api/v1/auth/switch-org", tag = "auth",
    request_body = SwitchOrgRequest,
    responses((status = 200, body = AuthResponse), (status = 401, description = "Not a member"))
)]
pub async fn switch_org(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SwitchOrgRequest>,
) -> Result<(HeaderMap, Json<AuthResponse>), AppError> {
    let claims = verify_request(&state, &headers).await?;

    let tenant = db::postgres::tenants::get_tenant_by_slug(&state.pg, &req.tenant_slug)
        .await
        .map_err(|_| AppError::NotFound("Organization not found".into()))?;

    let user = db::postgres::users::get_user_by_email(&state.pg, tenant.id, &claims.email)
        .await
        .map_err(|_| AppError::Unauthorized("You are not a member of this organization".into()))?;

    let roles = db::postgres::rbac::get_user_roles(&state.pg, user.id).await?;
    let role_names: Vec<String> = roles.iter().map(|r| r.name.clone()).collect();
    let permissions = db::postgres::rbac::get_user_permissions(&state.pg, user.id).await?;

    let access_token = auth::jwt::issue_access_token(
        &state.jwt_keys,
        user.id,
        tenant.id,
        &user.email,
        role_names.clone(),
        permissions,
    )
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let refresh_token = auth::jwt::generate_refresh_token();
    let refresh_hash = auth::jwt::hash_refresh_token(&refresh_token);
    let refresh_expires = chrono::Utc::now() + chrono::Duration::days(30);
    db::postgres::refresh_tokens::create_refresh_token(
        &state.pg,
        user.id,
        tenant.id,
        &refresh_hash,
        refresh_expires,
    )
    .await?;

    let cookies = auth_cookies(&access_token, &refresh_token);

    Ok((
        cookies,
        Json(AuthResponse {
            expires_in: 900,
            user: UserInfo {
                id: user.id,
                email: user.email,
                display_name: user.display_name,
                tenant_id: tenant.id,
                tenant_slug: tenant.slug,
                roles: role_names,
            },
        }),
    ))
}

pub fn router() -> Router<AppState> {
    use axum::routing::get;
    Router::new()
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/refresh", post(refresh))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
        .route("/auth/orgs", get(list_user_orgs))
        .route("/auth/switch-org", post(switch_org))
}
