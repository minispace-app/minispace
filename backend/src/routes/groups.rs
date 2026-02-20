use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    middleware::tenant::TenantSlug,
    models::{
        auth::AuthenticatedUser,
        group::{CreateGroupRequest, UpdateGroupRequest},
        user::UserRole,
    },
    services::groups::GroupService,
    AppState,
};

fn require_admin(user: &AuthenticatedUser) -> Option<(StatusCode, Json<Value>)> {
    match user.role {
        UserRole::AdminGarderie | UserRole::SuperAdmin => None,
        _ => Some((StatusCode::FORBIDDEN, Json(json!({ "error": "Accès refusé" })))),
    }
}

#[derive(Deserialize)]
pub struct SetChildrenRequest {
    pub child_ids: Vec<Uuid>,
}

pub async fn list_groups(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    _user: AuthenticatedUser,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    GroupService::list(&state.db, &tenant)
        .await
        .map(|groups| Json(serde_json::to_value(groups).unwrap()))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}

pub async fn create_group(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Json(body): Json<CreateGroupRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if let Some(err) = require_admin(&user) { return Err(err); }
    GroupService::create(&state.db, &tenant, &body)
        .await
        .map(|group| (StatusCode::CREATED, Json(serde_json::to_value(group).unwrap())))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}

pub async fn update_group(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateGroupRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = require_admin(&user) { return Err(err); }
    GroupService::update(&state.db, &tenant, id, &body)
        .await
        .map(|group| Json(serde_json::to_value(group).unwrap()))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}

pub async fn set_group_children(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(body): Json<SetChildrenRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = require_admin(&user) { return Err(err); }
    GroupService::set_children(&state.db, &tenant, id, &body.child_ids)
        .await
        .map(|_| Json(json!({ "message": "Children updated" })))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}

pub async fn delete_group(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    if let Some(err) = require_admin(&user) { return Err(err); }
    GroupService::delete(&state.db, &tenant, id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}
