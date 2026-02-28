use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    middleware::tenant::TenantSlug,
    models::{auth::AuthenticatedUser, user::UserRole},
    AppState,
};

/// GET /settings — any authenticated user
pub async fn get_settings(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    _user: AuthenticatedUser,
) -> (StatusCode, Json<Value>) {
    let time: Option<String> = sqlx::query_scalar(
        "SELECT journal_auto_send_time FROM public.garderies WHERE slug = $1",
    )
    .bind(&tenant)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    (
        StatusCode::OK,
        Json(json!({ "journal_auto_send_time": time.unwrap_or_else(|| "16:30".into()) })),
    )
}

#[derive(Deserialize)]
pub struct UpdateSettingsRequest {
    pub journal_auto_send_time: String,
}

/// PUT /settings — admin only
pub async fn update_settings(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Json(body): Json<UpdateSettingsRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    match user.role {
        UserRole::AdminGarderie | UserRole::SuperAdmin => {}
        _ => {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({ "error": "Accès refusé" })),
            ))
        }
    }

    // Validate HH:MM format
    let parts: Vec<&str> = body.journal_auto_send_time.split(':').collect();
    let valid = parts.len() == 2
        && parts[0].parse::<u32>().map(|h| h <= 23).unwrap_or(false)
        && parts[1].parse::<u32>().map(|m| m <= 59).unwrap_or(false);

    if !valid {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Format invalide — utilisez HH:MM (ex: 16:30)" })),
        ));
    }

    sqlx::query(
        "UPDATE public.garderies SET journal_auto_send_time = $1 WHERE slug = $2",
    )
    .bind(&body.journal_auto_send_time)
    .bind(&tenant)
    .execute(&state.db)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;

    Ok(Json(
        json!({ "journal_auto_send_time": body.journal_auto_send_time }),
    ))
}
