use axum::{extract::State, http::StatusCode, Json};
use serde_json::{json, Value};

use crate::{middleware::tenant::TenantSlug, AppState};

pub async fn get_tenant_info(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
) -> (StatusCode, Json<Value>) {
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT name, logo_url FROM public.garderies WHERE slug = $1 AND is_active = TRUE",
    )
    .bind(&tenant)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match row {
        Some((name, logo_url)) => (
            StatusCode::OK,
            Json(json!({ "name": name, "logo_url": logo_url })),
        ),
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Tenant not found" })),
        ),
    }
}
