use axum::{
    extract::{Path, Query, State},
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
        activity::{
            ActivitiesListQuery, Activity, ActivityRegistrationWithChild, CreateActivityRequest, RegisterRequest,
            UpdateActivityRequest,
        },
        auth::AuthenticatedUser,
        user::UserRole,
    },
    AppState,
};

/// GET /activities?month=YYYY-MM&child_id=...
/// Returns activities for a given month
/// If child_id is provided, includes registration status for that child
pub async fn list_activities(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    _user: AuthenticatedUser,
    Query(params): Query<ActivitiesListQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
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

    // Fetch activities with registration counts
    // Include activities that have a start date within the month,
    // or span across the month (end_date >= first_day)
    let mut activities = sqlx::query_as::<_, Activity>(
        &format!(
            "SELECT a.id, a.title, a.description, a.date, a.end_date, a.capacity, a.group_id, a.type, a.created_by, a.created_at, a.updated_at,
                    CAST(COUNT(ar.id) AS INT) as registration_count
             FROM {}.activities a
             LEFT JOIN {}.activity_registrations ar ON a.id = ar.activity_id
             WHERE a.date <= $2 AND (a.end_date IS NULL AND a.date >= $1 OR a.end_date IS NOT NULL AND a.end_date >= $1)
             GROUP BY a.id, a.type
             ORDER BY a.date ASC",
            schema, schema
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

    // If child_id is provided, add registration status
    if let Some(child_id) = params.child_id {
        for activity in &mut activities {
            let is_registered = sqlx::query_scalar::<_, bool>(
                &format!(
                    "SELECT EXISTS(SELECT 1 FROM {}.activity_registrations WHERE activity_id = $1 AND child_id = $2)",
                    schema
                ),
            )
            .bind(activity.id)
            .bind(child_id)
            .fetch_one(&state.db)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": e.to_string() })),
                )
            })?;
            activity.is_registered = Some(is_registered);
        }
    }

    Ok(Json(json!({ "activities": activities })))
}

/// POST /activities
/// Create a new activity
/// Access: Admin only
pub async fn create_activity(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Json(req): Json<CreateActivityRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Admin only
    if !matches!(user.role, UserRole::AdminGarderie) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Only admin can create activities" })),
        ));
    }

    let date = NaiveDate::parse_from_str(&req.date, "%Y-%m-%d")
        .map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid date format" }))))?;

    let end_date = if let Some(end_date_str) = &req.end_date {
        Some(NaiveDate::parse_from_str(end_date_str, "%Y-%m-%d")
            .map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid end_date format" }))))?)
    } else {
        None
    };

    let schema = schema_name(&tenant);

    let activity_id = Uuid::new_v4();
    let activity_type = req.activity_type.as_deref().unwrap_or("sortie");

    sqlx::query(
        &format!(
            "INSERT INTO {}.activities (id, title, description, date, end_date, capacity, group_id, type, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())",
            schema
        ),
    )
    .bind(activity_id)
    .bind(&req.title)
    .bind(&req.description)
    .bind(date)
    .bind(end_date)
    .bind(req.capacity)
    .bind(req.group_id)
    .bind(activity_type)
    .bind(user.user_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;

    Ok(Json(json!({ "id": activity_id })))
}

/// PUT /activities/:id
/// Update an activity
/// Access: Admin only
pub async fn update_activity(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(activity_id): Path<Uuid>,
    Json(req): Json<UpdateActivityRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Admin only
    if !matches!(user.role, UserRole::AdminGarderie) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Only admin can update activities" })),
        ));
    }

    let schema = schema_name(&tenant);

    let activity_exists = sqlx::query_scalar::<_, bool>(
        &format!("SELECT EXISTS(SELECT 1 FROM {}.activities WHERE id = $1)", schema),
    )
    .bind(activity_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;

    if !activity_exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({ "error": "Activity not found" }))));
    }

    // Update each field individually if provided
    if let Some(title) = &req.title {
        sqlx::query(&format!("UPDATE {}.activities SET title = $1, updated_at = NOW() WHERE id = $2", schema))
            .bind(title)
            .bind(activity_id)
            .execute(&state.db)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": e.to_string() })),
                )
            })?;
    }

    if let Some(description) = req.description.as_ref() {
        sqlx::query(&format!("UPDATE {}.activities SET description = $1, updated_at = NOW() WHERE id = $2", schema))
            .bind(description)
            .bind(activity_id)
            .execute(&state.db)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": e.to_string() })),
                )
            })?;
    }

    if let Some(date_str) = &req.date {
        let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
            .map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid date format" }))))?;
        sqlx::query(&format!("UPDATE {}.activities SET date = $1, updated_at = NOW() WHERE id = $2", schema))
            .bind(date)
            .bind(activity_id)
            .execute(&state.db)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": e.to_string() })),
                )
            })?;
    }

    if let Some(capacity) = req.capacity {
        sqlx::query(&format!("UPDATE {}.activities SET capacity = $1, updated_at = NOW() WHERE id = $2", schema))
            .bind(capacity)
            .bind(activity_id)
            .execute(&state.db)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": e.to_string() })),
                )
            })?;
    }

    if let Some(end_date_str) = &req.end_date {
        let end_date = NaiveDate::parse_from_str(end_date_str, "%Y-%m-%d")
            .map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid end_date format" }))))?;
        sqlx::query(&format!("UPDATE {}.activities SET end_date = $1, updated_at = NOW() WHERE id = $2", schema))
            .bind(end_date)
            .bind(activity_id)
            .execute(&state.db)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": e.to_string() })),
                )
            })?;
    }

    if let Some(group_id) = req.group_id {
        sqlx::query(&format!("UPDATE {}.activities SET group_id = $1, updated_at = NOW() WHERE id = $2", schema))
            .bind(group_id)
            .bind(activity_id)
            .execute(&state.db)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": e.to_string() })),
                )
            })?;
    }

    if let Some(activity_type) = &req.activity_type {
        sqlx::query(&format!("UPDATE {}.activities SET type = $1, updated_at = NOW() WHERE id = $2", schema))
            .bind(activity_type)
            .bind(activity_id)
            .execute(&state.db)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": e.to_string() })),
                )
            })?;
    }

    Ok(Json(json!({ "success": true })))
}

/// DELETE /activities/:id
/// Delete an activity
/// Access: Admin only
pub async fn delete_activity(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(activity_id): Path<Uuid>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Admin only
    if !matches!(user.role, UserRole::AdminGarderie) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Only admin can delete activities" })),
        ));
    }

    let schema = schema_name(&tenant);

    let result = sqlx::query(&format!("DELETE FROM {}.activities WHERE id = $1", schema))
        .bind(activity_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(json!({ "error": "Activity not found" }))));
    }

    Ok(Json(json!({ "success": true })))
}

/// POST /activities/:id/register
/// Register a child to an activity
/// Access: Parent (own child) + Admin
pub async fn register_child(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(activity_id): Path<Uuid>,
    Json(req): Json<RegisterRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let schema = schema_name(&tenant);

    // Check access: parent can only register own children
    if let UserRole::Parent = user.role {
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

    // Check if activity exists and get capacity + type
    let activity = sqlx::query_as::<_, (Option<i32>, String)>(
        &format!("SELECT capacity, type FROM {}.activities WHERE id = $1", schema),
    )
    .bind(activity_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;

    let (capacity, activity_type) = activity.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Activity not found" })),
        )
    })?;

    // Cannot register for theme activities
    if activity_type == "theme" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Cannot register for theme activities" })),
        ));
    }

    // If capacity is limited, check current registration count
    if let Some(cap) = capacity {
        let current_count = sqlx::query_scalar::<_, i64>(
            &format!(
                "SELECT COUNT(*) FROM {}.activity_registrations WHERE activity_id = $1",
                schema
            ),
        )
        .bind(activity_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })?;

        if current_count >= cap as i64 {
            return Err((
                StatusCode::CONFLICT,
                Json(json!({ "error": "Activity is at capacity" })),
            ));
        }
    }

    // Insert registration
    let registration_id = Uuid::new_v4();
    sqlx::query(
        &format!(
            "INSERT INTO {}.activity_registrations (id, activity_id, child_id, registered_by, created_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (activity_id, child_id) DO NOTHING",
            schema
        ),
    )
    .bind(registration_id)
    .bind(activity_id)
    .bind(req.child_id)
    .bind(user.user_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;

    Ok(Json(json!({ "id": registration_id })))
}

/// DELETE /activities/:id/register/:child_id
/// Unregister a child from an activity
/// Access: Parent (own child) + Admin
pub async fn unregister_child(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path((activity_id, child_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let schema = schema_name(&tenant);

    // Check access: parent can only unregister own children
    if let UserRole::Parent = user.role {
        let is_linked = sqlx::query_scalar::<_, bool>(
            &format!(
                "SELECT EXISTS(SELECT 1 FROM {}.child_parents WHERE child_id = $1 AND user_id = $2)",
                schema
            ),
        )
        .bind(child_id)
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

    let result = sqlx::query(
        &format!(
            "DELETE FROM {}.activity_registrations WHERE activity_id = $1 AND child_id = $2",
            schema
        ),
    )
    .bind(activity_id)
    .bind(child_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Registration not found" })),
        ));
    }

    Ok(Json(json!({ "success": true })))
}

/// GET /activities/:id/registrations
/// Get all registrations for an activity
/// Access: Admin and educateurs only
pub async fn get_activity_registrations(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(activity_id): Path<Uuid>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Admin and educateurs only
    if !matches!(user.role, UserRole::AdminGarderie | UserRole::Educateur) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Only admin and educateurs can view registrations" })),
        ));
    }

    let schema = schema_name(&tenant);

    let registrations = sqlx::query_as::<_, ActivityRegistrationWithChild>(
        &format!(
            "SELECT ar.id, ar.child_id, c.first_name, c.last_name, ar.registered_by, ar.created_at
             FROM {}.activity_registrations ar
             JOIN {}.children c ON c.id = ar.child_id
             WHERE ar.activity_id = $1
             ORDER BY c.last_name, c.first_name",
            schema, schema
        ),
    )
    .bind(activity_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;

    Ok(Json(json!({ "registrations": registrations })))
}
