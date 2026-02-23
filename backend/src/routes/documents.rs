use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    middleware::tenant::TenantSlug,
    models::{auth::AuthenticatedUser, document::{DocumentQuery, UpdateDocumentRequest}, user::UserRole},
    services::documents::DocumentService,
    AppState,
};

pub async fn upload_document(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    multipart: Multipart,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    DocumentService::upload(
        &state.db,
        &tenant,
        user.user_id,
        &state.config.media_dir,
        &state.config.encryption_master_key,
        multipart,
    )
    .await
    .map(|doc| (StatusCode::CREATED, Json(serde_json::to_value(doc).unwrap())))
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })
}

pub async fn update_document(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateDocumentRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let is_staff = !matches!(user.role, UserRole::Parent);
    match DocumentService::update(&state.db, &tenant, id, user.user_id, is_staff, &req).await {
        Ok(Some(doc)) => Ok(Json(serde_json::to_value(doc).unwrap())),
        Ok(None) => Err((StatusCode::NOT_FOUND, Json(json!({ "error": "not found" })))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))),
    }
}

pub async fn delete_document(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    let is_staff = !matches!(user.role, UserRole::Parent);
    match DocumentService::delete(&state.db, &tenant, id, user.user_id, is_staff, &state.config.media_dir).await {
        Ok(true) => Ok(StatusCode::NO_CONTENT),
        Ok(false) => Err((StatusCode::NOT_FOUND, Json(json!({ "error": "not found" })))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))),
    }
}

pub async fn list_documents(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Query(query): Query<DocumentQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let is_staff = !matches!(user.role, UserRole::Parent);
    DocumentService::list(&state.db, &tenant, user.user_id, is_staff, &query)
        .await
        .map(|docs| Json(serde_json::to_value(docs).unwrap()))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}
