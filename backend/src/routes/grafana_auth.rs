use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use rand::Rng;
use redis::AsyncCommands;
use serde_json::json;

use crate::{
    middleware::auth::decode_access_token,
    models::user::UserRole,
    AppState,
};

fn is_authorized(headers: &HeaderMap, state: &AppState) -> bool {
    // Accept X-Super-Admin-Key (platform super-admin without JWT)
    if headers
        .get("x-super-admin-key")
        .and_then(|v| v.to_str().ok())
        .map(|k| k == state.config.super_admin_key)
        .unwrap_or(false)
    {
        return true;
    }

    // Accept JWT with admin_garderie or super_admin role
    if let Some(bearer) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        if let Ok(user) = decode_access_token(bearer, &state.config.jwt_secret) {
            return user.role == UserRole::SuperAdmin || user.role == UserRole::AdminGarderie;
        }
    }

    false
}

/// POST /super-admin/grafana-access
/// Accepts either X-Super-Admin-Key header or JWT (admin_garderie / super_admin).
/// Sets a short-lived HttpOnly cookie used by nginx auth_request for Grafana SSO.
pub async fn grafana_access(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if !is_authorized(&headers, &state) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Accès refusé" })),
        )
            .into_response();
    }

    // Generate a random 32-byte hex token
    let token: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(48)
        .map(char::from)
        .collect();

    let redis_key = format!("grafana_access:{}", token);
    let mut redis = state.redis.clone();

    if let Err(e) = redis
        .set_ex::<_, _, ()>(&redis_key, "1", 1800)
        .await
    {
        tracing::warn!("grafana_access: Redis error: {}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Erreur interne" })),
        )
            .into_response();
    }

    let cookie = format!(
        "ms_grafana_access={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1800",
        token
    );

    (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie)],
        Json(json!({ "ok": true })),
    )
        .into_response()
}

/// GET /super-admin/grafana-auth
/// Internal nginx auth_request subrequest endpoint.
/// Reads the `ms_grafana_access` cookie, validates against Redis.
/// Returns 200 (allow) or 401 (deny).
pub async fn grafana_auth(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> StatusCode {
    let cookies = headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let token = cookies.split(';').find_map(|c| {
        let c = c.trim();
        c.strip_prefix("ms_grafana_access=")
    });

    let token = match token {
        Some(t) if !t.is_empty() => t,
        _ => return StatusCode::UNAUTHORIZED,
    };

    let redis_key = format!("grafana_access:{}", token);
    let mut redis = state.redis.clone();

    match redis.exists::<_, bool>(&redis_key).await {
        Ok(true) => StatusCode::OK,
        _ => StatusCode::UNAUTHORIZED,
    }
}
