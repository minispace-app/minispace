use axum::{extract::State, http::StatusCode, Json};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};

use crate::{middleware::tenant::TenantSlug, AppState};

pub async fn get_tenant_info(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
) -> (StatusCode, Json<Value>) {
    let row: Option<(String, Option<String>, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT name, logo_url, trial_expires_at FROM public.garderies WHERE slug = $1 AND is_active = TRUE",
    )
    .bind(&tenant)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match row {
        Some((name, logo_url, trial_expires_at)) => (
            StatusCode::OK,
            Json(json!({ "name": name, "logo_url": logo_url, "trial_expires_at": trial_expires_at })),
        ),
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Tenant not found" })),
        ),
    }
}
