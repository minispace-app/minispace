use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    middleware::tenant::TenantSlug,
    models::{
        auth::AuthenticatedUser,
        child::{AssignParentRequest, CreateChildRequest, UpdateChildRequest},
        user::UserRole,
    },
    services::children::ChildService,
    AppState,
};

fn forbid_parent(user: &AuthenticatedUser) -> Option<(StatusCode, Json<Value>)> {
    if let UserRole::Parent = user.role {
        Some((StatusCode::FORBIDDEN, Json(json!({ "error": "Accès refusé" }))))
    } else {
        None
    }
}

/// Only admin_garderie and super_admin may perform write operations.
fn require_admin(user: &AuthenticatedUser) -> Option<(StatusCode, Json<Value>)> {
    match user.role {
        UserRole::AdminGarderie | UserRole::SuperAdmin => None,
        _ => Some((StatusCode::FORBIDDEN, Json(json!({ "error": "Accès refusé" })))),
    }
}

pub async fn list_children(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let children = match user.role {
        UserRole::Parent => {
            ChildService::list_for_parent(&state.db, &tenant, user.user_id).await
        }
        _ => ChildService::list(&state.db, &tenant).await,
    };

    children
        .map(|c| Json(serde_json::to_value(c).unwrap()))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}

pub async fn create_child(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Json(body): Json<CreateChildRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if let Some(err) = require_admin(&user) {
        return Err(err);
    }

    ChildService::create(&state.db, &tenant, &body)
        .await
        .map(|child| (StatusCode::CREATED, Json(serde_json::to_value(child).unwrap())))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}

pub async fn update_child(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateChildRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = require_admin(&user) {
        return Err(err);
    }
    let req = body;

    ChildService::update(&state.db, &tenant, id, &req)
        .await
        .map(|child| Json(serde_json::to_value(child).unwrap()))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))
}

pub async fn list_parents(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(child_id): Path<Uuid>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = require_admin(&user) {
        return Err(err);
    }

    ChildService::list_parents_for_child(&state.db, &tenant, child_id)
        .await
        .map(|p| Json(serde_json::to_value(p).unwrap()))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))
}

pub async fn assign_parent(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(child_id): Path<Uuid>,
    Json(body): Json<AssignParentRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = require_admin(&user) {
        return Err(err);
    }

    ChildService::assign_parent(&state.db, &tenant, child_id, &body)
        .await
        .map(|_| Json(json!({ "message": "Parent assigné" })))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))
}

pub async fn remove_parent(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path((child_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = require_admin(&user) {
        return Err(err);
    }

    ChildService::remove_parent(&state.db, &tenant, child_id, user_id)
        .await
        .map(|_| Json(json!({ "message": "Parent retiré" })))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))
}

pub async fn delete_child(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = require_admin(&user) {
        return Err(err);
    }

    ChildService::delete(&state.db, &tenant, id)
        .await
        .map(|_| Json(json!({ "message": "Enfant supprimé" })))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))
}
