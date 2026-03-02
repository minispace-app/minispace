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
    db::tenant::schema_name,
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

/// GET /journals/month?child_id=...&month=YYYY-MM
/// Returns dates that have a journal entry in a given month (summary only)
pub async fn get_month_summary(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Query(params): Query<MonthSummaryQuery>,
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

    // Parse month
    let month_parts: Vec<&str> = params.month.split('-').collect();
    if month_parts.len() != 2 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid month format. Use YYYY-MM" })),
        ));
    }

    let year = month_parts[0]
        .parse::<i32>()
        .map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid year" }))))?;
    let month = month_parts[1]
        .parse::<u32>()
        .map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid month" }))))?;

    if month < 1 || month > 12 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Month must be 1-12" })),
        ));
    }

    let start_date = NaiveDate::from_ymd_opt(year, month, 1).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid date" })),
        )
    })?;

    let end_date = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1).unwrap()
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1).unwrap()
    };

    let schema = schema_name(&tenant);

    let records = sqlx::query_as::<_, (NaiveDate, bool)>(
        &format!(
            "SELECT date, sent_at IS NOT NULL as sent FROM {}.daily_journals
             WHERE child_id = $1 AND date >= $2 AND date < $3
             ORDER BY date ASC",
            schema
        ),
    )
    .bind(params.child_id)
    .bind(start_date)
    .bind(end_date)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;

    let journal_dates: Vec<serde_json::Value> = records
        .into_iter()
        .map(|(date, sent)| json!({ "date": date.to_string(), "sent": sent }))
        .collect();

    Ok(Json(json!({ "journals": journal_dates })))
}

#[derive(Deserialize)]
pub struct MonthSummaryQuery {
    pub child_id: Uuid,
    pub month: String, // YYYY-MM
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
