use axum::{
    extract::{Path, State},
    routing::{delete, get},
    Extension, Json, Router,
};
use serde::Deserialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::routes::responses::{ApiKeyListResponse, CreateApiKeyResponse};
use crate::state::AppState;
use auth::middleware::CurrentUser;
use common::AppError;

#[derive(Deserialize, ToSchema)]
pub struct CreateKeyRequest {
    pub name: String,
    pub permissions: Vec<String>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[utoipa::path(
    get,
    path = "/api/v1/api-keys",
    tag = "auth",
    responses((status = 200, description = "Success", body = ApiKeyListResponse))
)]
pub async fn list_keys(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<ApiKeyListResponse>, AppError> {
    auth::rbac::check_permission(&user, "api_keys_manage")?;
    let keys = db::postgres::api_keys::list_api_keys(&state.pg, user.tenant_id).await?;
    Ok(Json(ApiKeyListResponse { data: keys }))
}

#[utoipa::path(
    post,
    path = "/api/v1/api-keys",
    tag = "auth",
    request_body = CreateKeyRequest,
    responses((status = 200, description = "Success", body = CreateApiKeyResponse))
)]
pub async fn create_key(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Json(req): Json<CreateKeyRequest>,
) -> Result<Json<CreateApiKeyResponse>, AppError> {
    auth::rbac::check_permission(&user, "api_keys_manage")?;

    let (raw_key, prefix) = auth::api_key::generate_api_key();
    let key_hash = auth::api_key::hash_api_key(&raw_key);

    let api_key = db::postgres::api_keys::create_api_key(
        &state.pg,
        &db::postgres::models::CreateApiKey {
            tenant_id: user.tenant_id,
            created_by: user.user_id,
            name: req.name,
            key_prefix: prefix,
            key_hash,
            permissions: req.permissions,
            expires_at: req.expires_at,
        },
    )
    .await?;

    // Return the raw key ONCE - it won't be retrievable again
    Ok(Json(CreateApiKeyResponse {
        key: raw_key,
        id: api_key.id,
        name: api_key.name,
        key_prefix: api_key.key_prefix,
        message: "Store this key securely. It cannot be retrieved again.".into(),
    }))
}

#[utoipa::path(
    delete,
    path = "/api/v1/api-keys/{key_id}",
    tag = "auth",
    params(("key_id" = Uuid, Path, description = "API key ID")),
    responses((status = 200, description = "Success", body = serde_json::Value))
)]
pub async fn revoke_key(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(key_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth::rbac::check_permission(&user, "api_keys_manage")?;
    db::postgres::api_keys::revoke_api_key(&state.pg, key_id).await?;
    Ok(Json(serde_json::json!({ "revoked": true })))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api-keys", get(list_keys).post(create_key))
        .route("/api-keys/{key_id}", delete(revoke_key))
}
