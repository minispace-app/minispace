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
    models::{auth::AuthenticatedUser, user::UserRole},
    AppState,
};

/// POST /super-admin/grafana-access
/// Requires valid JWT with super_admin role.
/// Generates a short-lived cookie token stored in Redis (30 min TTL),
/// then sets it as an HttpOnly cookie so the browser sends it on /grafana/ navigation.
pub async fn grafana_access(
    State(state): State<AppState>,
    user: AuthenticatedUser,
) -> impl IntoResponse {
    if user.role != UserRole::SuperAdmin {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Super-admin requis" })),
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
