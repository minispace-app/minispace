use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::NaiveDate;
use serde::{Deserialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    middleware::tenant::TenantSlug,
    models::{
        auth::AuthenticatedUser,
        journal::{JournalWeekQuery, UpsertJournalRequest},
        user::UserRole,
    },
    services::journal::JournalService,
    AppState,
};

/// GET /journals?child_id=...&week_start=YYYY-MM-DD
pub async fn get_week(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Query(params): Query<JournalWeekQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Parents may only read journals for their own children.
    if let UserRole::Parent = user.role {
        let linked =
            JournalService::assert_parent_access(&state.db, &tenant, params.child_id, user.user_id)
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": e.to_string() })),
                    )
                })?;
        if !linked {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({ "error": "Accès refusé" })),
            ));
        }
    }

    JournalService::list_week(&state.db, &tenant, params.child_id, params.week_start)
        .await
        .map(|entries| Json(serde_json::to_value(entries).unwrap()))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}

/// PUT /journals — staff only
pub async fn upsert_entry(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Json(body): Json<UpsertJournalRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let UserRole::Parent = user.role {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Accès refusé" })),
        ));
    }

    JournalService::upsert(&state.db, &tenant, &body, user.user_id)
        .await
        .map(|entry| Json(serde_json::to_value(entry).unwrap()))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}

#[derive(Deserialize)]
pub struct SendJournalRequest {
    pub week_start: NaiveDate,
}

/// POST /journals/send-all-to-parents — send this week's journals for ALL children
pub async fn send_all_to_parents(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Json(body): Json<SendJournalRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    crate::routes::demo::deny_if_demo(&tenant)?;
    if let UserRole::Parent = user.role {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Accès refusé" }))));
    }

    JournalService::send_all_journals_to_parents(
        &state.db,
        state.email.as_deref(),
        &tenant,
        body.week_start,
    )
    .await
    .map(|msg| Json(json!({ "message": msg })))
    .map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        )
    })
}

/// POST /journals/:child_id/send-to-parents — send weekly journal to all parents
pub async fn send_to_parents(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(child_id): Path<Uuid>,
    Json(body): Json<SendJournalRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    crate::routes::demo::deny_if_demo(&tenant)?;
    // Only educators and admins can send journals
    if let UserRole::Parent = user.role {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Accès refusé" })),
        ));
    }

    JournalService::send_journal_to_parents(
        &state.db,
        state.email.as_deref(),
        &tenant,
        child_id,
        body.week_start,
    )
    .await
    .map(|msg| Json(json!({ "message": msg })))
    .map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        )
    })
}
