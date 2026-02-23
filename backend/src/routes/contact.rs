use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{middleware::rate_limit::check_rate_limit, AppState};

#[derive(Deserialize)]
pub struct ContactRequest {
    pub name: String,
    pub email: String,
    pub garderie: String,
    pub phone: String,
}

#[derive(Serialize)]
pub struct ContactResponse {
    pub success: bool,
}

pub async fn submit_contact(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ContactRequest>,
) -> Result<Json<ContactResponse>, (StatusCode, Json<serde_json::Value>)> {
    // Rate limit by IP: max 5 requests per hour
    // Extract real client IP from X-Real-IP header (set by nginx from Cloudflare)
    let ip = headers
        .get("X-Real-IP")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    let rate_limit_key = format!("contact:form:{}", ip);

    let mut redis = state.redis.clone();

    check_rate_limit(&mut redis, &rate_limit_key, 5, 3600).await?;

    let email_service = state.email.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Email service unavailable"})),
    ))?;

    email_service
        .send_contact_request(
            &payload.name,
            &payload.email,
            &payload.garderie,
            &payload.phone,
        )
        .await
        .map_err(|e| {
            tracing::error!("Failed to send contact request email: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Failed to process request"})),
            )
        })?;

    Ok(Json(ContactResponse { success: true }))
}
