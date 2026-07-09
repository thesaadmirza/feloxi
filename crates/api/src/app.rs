use axum::{
    http::{header, HeaderValue, Method},
    middleware as axum_mw,
    routing::get,
    Router,
};
use tower_http::{compression::CompressionLayer, cors::CorsLayer, trace::TraceLayer};
use utoipa::OpenApi;

use crate::{openapi::ApiDoc, routes, state::AppState, ws};

pub fn create_router(state: AppState) -> Router {
    // Public routes (no auth required)
    let public = Router::new()
        .merge(routes::health::router())
        .merge(routes::auth::router())
        .merge(routes::setup::router())
        .merge(routes::oauth_slack::public_router())
        .merge(routes::oauth_discord::public_router())
        .merge(routes::system::public_router());

    // Protected routes (JWT auth required)
    let protected = Router::new()
        .merge(routes::tasks::router())
        .merge(routes::workers::router())
        .merge(routes::brokers::router())
        .merge(routes::beat::router())
        .merge(routes::alerts::router())
        .merge(routes::integrations::router())
        .merge(routes::oauth_slack::protected_router())
        .merge(routes::oauth_discord::protected_router())
        .merge(routes::metrics::router())
        .merge(routes::api_keys::router())
        .merge(routes::tenants::router())
        .merge(routes::dashboards::router())
        .merge(routes::workflows::router())
        .merge(routes::system::protected_router())
        .layer(axum_mw::from_fn_with_state(
            state.jwt_keys.as_ref().clone(),
            auth::middleware::auth_middleware,
        ));

    // API v1 namespace
    let api_v1 = Router::new().merge(public).merge(protected);

    // WebSocket routes
    let ws_routes = Router::new().route("/ws/dashboard", get(ws::handler::dashboard_ws));

    // Prometheus metrics endpoint (no auth, scraped by Prometheus)
    let disable_prom =
        std::env::var("DISABLE_PROMETHEUS").map(|v| v == "true" || v == "1").unwrap_or(false);
    let prom_routes = if disable_prom { Router::new() } else { routes::prometheus::router() };

    // Combine all routes
    let mut app = Router::new().nest("/api/v1", api_v1).merge(ws_routes).merge(prom_routes);

    // OpenAPI spec + Swagger UI (disabled when DISABLE_SWAGGER=true)
    let disable_swagger =
        std::env::var("DISABLE_SWAGGER").map(|v| v == "true" || v == "1").unwrap_or(false);
    if !disable_swagger {
        app = app
            .merge(utoipa_swagger_ui::SwaggerUi::new("/").url("/openapi.json", ApiDoc::openapi()));
    }

    app.layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer({
            let origins: Vec<HeaderValue> = state
                .config
                .cors_origin
                .split(',')
                .filter_map(|s| s.trim().parse::<HeaderValue>().ok())
                .collect();
            CorsLayer::new()
                .allow_origin(origins)
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PUT,
                    Method::DELETE,
                    Method::OPTIONS,
                ])
                .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION, header::ACCEPT])
                .allow_credentials(true)
        })
        .with_state(state)
}
