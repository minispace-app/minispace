use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};

use crate::{
    middleware::super_admin::SuperAdminAuth,
    models::announcement::{Announcement, SetAnnouncementRequest},
    AppState,
};

/// GET /announcement — public endpoint, returns the active announcement or null.
pub async fn get_announcement(
    State(state): State<AppState>,
) -> Json<Value> {
    let row = sqlx::query_as::<_, Announcement>(
        "SELECT * FROM announcements WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 1",
    )
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    match row {
        Some(a) => Json(json!({ "message": a.message, "color": a.color })),
        None => Json(json!(null)),
    }
}

/// PUT /super-admin/announcement — set (or replace) the active announcement.
pub async fn set_announcement(
    State(state): State<AppState>,
    _auth: SuperAdminAuth,
    Json(body): Json<SetAnnouncementRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let color = body.color.as_deref().unwrap_or("yellow");

    // Deactivate any existing announcements, then insert the new one
    sqlx::query("UPDATE announcements SET is_active = FALSE WHERE is_active = TRUE")
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    let announcement = sqlx::query_as::<_, Announcement>(
        "INSERT INTO announcements (message, color, is_active) VALUES ($1, $2, TRUE) RETURNING *",
    )
    .bind(&body.message)
    .bind(color)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    Ok(Json(serde_json::to_value(announcement).unwrap()))
}

/// DELETE /super-admin/announcement — deactivate all announcements.
pub async fn delete_announcement(
    State(state): State<AppState>,
    _auth: SuperAdminAuth,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    sqlx::query("UPDATE announcements SET is_active = FALSE WHERE is_active = TRUE")
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    Ok(Json(json!({ "ok": true })))
}
