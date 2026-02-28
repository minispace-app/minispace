use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};

use crate::{
    middleware::tenant::TenantSlug,
    models::{
        auth::AuthenticatedUser,
        menu::{MenuWeekQuery, UpsertMenuRequest},
        user::UserRole,
    },
    services::menu::MenuService,
    AppState,
};

/// GET /menus?week_start=YYYY-MM-DD — all authenticated users (parents included)
pub async fn get_week(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    _user: AuthenticatedUser,
    Query(params): Query<MenuWeekQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    MenuService::list_week(&state.db, &tenant, params.week_start)
        .await
        .map(|entries| Json(serde_json::to_value(entries).unwrap()))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}

/// PUT /menus — educators and admins only
pub async fn upsert_menu(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Json(body): Json<UpsertMenuRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let UserRole::Parent = user.role {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Accès refusé" })),
        ));
    }

    MenuService::upsert(&state.db, &tenant, &body, user.user_id)
        .await
        .map(|entry| Json(serde_json::to_value(entry).unwrap()))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}
