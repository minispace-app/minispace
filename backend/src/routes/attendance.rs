use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use chrono::NaiveDate;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
    middleware::tenant::TenantSlug,
    models::{
        attendance::{AttendanceMonthAllQuery, AttendanceMonthQuery, SetAttendanceRequest},
        auth::AuthenticatedUser,
        user::UserRole,
    },
    AppState,
};

/// GET /attendance?child_id=...&month=YYYY-MM
/// Returns attendance records for a single child in a given month
/// Access: Parent (only their children) + Staff
pub async fn get_month(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Query(params): Query<AttendanceMonthQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Parent check: can only view their own children
    if let UserRole::Parent = user.role {
        let schema = schema_name(&tenant);
        let is_linked = sqlx::query_scalar::<_, bool>(
            &format!("SELECT EXISTS(SELECT 1 FROM {}.child_parents WHERE child_id = $1 AND user_id = $2)", schema),
        )
        .bind(params.child_id)
        .bind(user.user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })?;

        if !is_linked {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({ "error": "Accès refusé" })),
            ));
        }
    }

    // Parse month to get start and end dates
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

    // Construct start and end dates
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

    let records = sqlx::query_as::<_, (String, String)>(
        &format!(
            "SELECT date::TEXT, status::TEXT FROM {}.attendance WHERE child_id = $1 AND date >= $2 AND date < $3 ORDER BY date ASC",
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

    let attendance_map: std::collections::HashMap<String, String> =
        records.into_iter().map(|(date, status)| (date.to_string(), status)).collect();

    Ok(Json(json!({ "attendance": attendance_map })))
}

/// PUT /attendance
/// Set attendance status for a child on a specific date
/// Access: Parent (vacances/present only, future dates only) + Staff (all statuses, all dates)
pub async fn set_attendance(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Json(req): Json<SetAttendanceRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let date = NaiveDate::parse_from_str(&req.date, "%Y-%m-%d")
        .map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid date format" }))))?;

    let schema = schema_name(&tenant);

    // Validate status
    let valid_statuses = [
        "attendu",
        "present",
        "absent",
        "malade",
        "vacances",
        "present_hors_contrat",
    ];
    if !valid_statuses.contains(&req.status.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid status" })),
        ));
    }

    // Check if parent and apply restrictions
    if let UserRole::Parent = user.role {
        // Parents can only set absent or present
        if !["absent", "present"].contains(&req.status.as_str()) {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({ "error": "Parents can only set absent or present status" })),
            ));
        }

        // Parents can only set future dates
        let today = chrono::Local::now().naive_local().date();
        if date < today {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({ "error": "Cannot change attendance for past dates" })),
            ));
        }

        // Verify child belongs to parent
        let is_linked = sqlx::query_scalar::<_, bool>(
            &format!(
                "SELECT EXISTS(SELECT 1 FROM {}.child_parents WHERE child_id = $1 AND user_id = $2)",
                schema
            ),
        )
        .bind(req.child_id)
        .bind(user.user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })?;

        if !is_linked {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({ "error": "Child not linked to parent" })),
            ));
        }
    }

    // Upsert attendance record
    let _result = sqlx::query(
        &format!(
            "INSERT INTO {}.attendance (child_id, date, status, marked_by, created_at, updated_at)
             VALUES ($1, $2, $3::{}.attendance_status, $4, NOW(), NOW())
             ON CONFLICT (child_id, date) DO UPDATE SET status = $3::{}.attendance_status, marked_by = $4, updated_at = NOW()",
            schema, schema, schema
        ),
    )
    .bind(req.child_id)
    .bind(date)
    .bind(&req.status)
    .bind(user.user_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;

    // Update journal absent flag if status is absent
    let is_absent = req.status == "absent";
    let _journal_result = sqlx::query(
        &format!(
            "INSERT INTO {}.daily_journals (child_id, date, absent, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, NOW(), NOW())
             ON CONFLICT (child_id, date) DO UPDATE SET absent = $3, updated_at = NOW()",
            schema
        ),
    )
    .bind(req.child_id)
    .bind(date)
    .bind(is_absent)
    .bind(user.user_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;

    Ok(Json(json!({ "success": true })))
}

/// GET /attendance/month?month=YYYY-MM
/// Returns all children's attendance for a given month
/// Access: Staff only
pub async fn get_month_all_children(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Query(params): Query<AttendanceMonthAllQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Only staff can access this
    match user.role {
        UserRole::SuperAdmin | UserRole::AdminGarderie | UserRole::Educateur => {}
        UserRole::Parent => {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({ "error": "Only staff can access this endpoint" })),
            ))
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

    let records = sqlx::query_as::<_, (Uuid, String, String)>(
        &format!(
            "SELECT child_id, date::TEXT, status::TEXT FROM {}.attendance WHERE date >= $1 AND date < $2 ORDER BY child_id, date",
            schema
        ),
    )
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

    Ok(Json(json!({ "attendance": records })))
}
