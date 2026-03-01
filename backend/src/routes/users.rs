use axum::{
    extract::{Path, State, Query},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
    middleware::tenant::TenantSlug,
    models::auth::AuthenticatedUser,
    models::user::UserRole,
    services::audit::{self, AuditEntry},
    AppState,
};

fn client_ip(h: &HeaderMap) -> String {
    h.get("x-real-ip").and_then(|v| v.to_str().ok())
        .or_else(|| h.get("x-forwarded-for").and_then(|v| v.to_str().ok())
            .and_then(|s| s.split(',').next()).map(|s| s.trim()))
        .unwrap_or("unknown")
        .to_string()
}

fn require_admin(user: &AuthenticatedUser) -> Result<(), (StatusCode, Json<Value>)> {
    match user.role {
        UserRole::AdminGarderie | UserRole::SuperAdmin => Ok(()),
        _ => Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Accès refusé" })))),
    }
}

/// List all users in the tenant.
pub async fn list_users(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&user)?;
    let schema = schema_name(&tenant);

    let rows = sqlx::query(&format!(
        "SELECT u.id, u.email, u.first_name, u.last_name, u.role::TEXT as role,
                u.is_active, u.preferred_locale, u.created_at, u.updated_at,
                c.privacy_accepted, c.photos_accepted
         FROM {schema}.users u
         LEFT JOIN {schema}.consent_records c ON u.id = c.user_id
         QUALIFY ROW_NUMBER() OVER (PARTITION BY u.id ORDER BY c.accepted_at DESC) = 1
         ORDER BY u.role, u.last_name, u.first_name"
    ))
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    // Get deletion requests from audit log
    let deletion_requests = sqlx::query_scalar::<_, String>(&format!(
        "SELECT DISTINCT resource_id FROM {schema}_audit.audit_log
         WHERE action = 'user.deletion_requested'
         AND created_at > NOW() - INTERVAL '30 days'"
    ))
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let deletion_set: std::collections::HashSet<String> = deletion_requests.into_iter().collect();

    let result: Vec<Value> = rows
        .iter()
        .map(|row| {
            use sqlx::Row;
            let user_id = row.get::<Uuid, _>("id").to_string();
            json!({
                "id": user_id.clone(),
                "email": row.get::<String, _>("email"),
                "first_name": row.get::<String, _>("first_name"),
                "last_name": row.get::<String, _>("last_name"),
                "role": row.get::<String, _>("role"),
                "is_active": row.get::<bool, _>("is_active"),
                "preferred_locale": row.get::<String, _>("preferred_locale"),
                "privacy_accepted": row.get::<Option<bool>, _>("privacy_accepted").unwrap_or(false),
                "photos_accepted": row.get::<Option<bool>, _>("photos_accepted").unwrap_or(false),
                "deletion_requested": deletion_set.contains(&user_id),
            })
        })
        .collect();

    Ok(Json(json!(result)))
}

#[derive(Deserialize)]
pub struct CreateUserRequest {
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub password: String,
    pub role: Option<String>,
    pub preferred_locale: Option<String>,
}

/// Create a user directly in the tenant (admin_garderie, no invitation required).
pub async fn create_user(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    headers: HeaderMap,
    user: AuthenticatedUser,
    Json(body): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    crate::routes::demo::deny_if_demo(&tenant)?;
    require_admin(&user)?;
    let schema = schema_name(&tenant);

    let role = body.role.as_deref().unwrap_or("parent");
    let valid_roles = ["admin_garderie", "educateur", "parent"];
    if !valid_roles.contains(&role) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Rôle invalide" }))));
    }

    let password_hash = bcrypt::hash(&body.password, 12)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    let locale = body.preferred_locale.as_deref().unwrap_or("fr");

    let user_id: Uuid = sqlx::query_scalar(&format!(
        "INSERT INTO {schema}.users (email, password_hash, first_name, last_name, role, preferred_locale)
         VALUES ($1, $2, $3, $4, $5::\"{schema}\".user_role, $6)
         RETURNING id"
    ))
    .bind(&body.email)
    .bind(&password_hash)
    .bind(&body.first_name)
    .bind(&body.last_name)
    .bind(role)
    .bind(locale)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({ "error": e.to_string() }))))?;

    audit::log(state.db.clone(), &tenant, AuditEntry {
        user_id:        Some(user.user_id),
        user_name:      None,
        action:         "user.create".to_string(),
        resource_type:  Some("user".to_string()),
        resource_id:    Some(user_id.to_string()),
        resource_label: Some(format!("{} {} ({})", body.first_name, body.last_name, body.email)),
        ip_address:     client_ip(&headers),
    });

    Ok((StatusCode::CREATED, Json(json!({
        "id": user_id.to_string(),
        "email": body.email,
        "first_name": body.first_name,
        "last_name": body.last_name,
        "role": role,
        "preferred_locale": locale,
        "is_active": true,
    }))))
}

#[derive(Deserialize)]
pub struct UpdateUserRequest {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub role: Option<String>,
    pub is_active: Option<bool>,
    pub preferred_locale: Option<String>,
}

#[derive(Deserialize)]
pub struct DeleteQuery {
    pub hard: Option<bool>,
}

/// Update a user's role or active status.
pub async fn update_user(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(target_id): Path<Uuid>,
    Json(body): Json<UpdateUserRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&user)?;
    let schema = schema_name(&tenant);

    // Validate role if provided
    if let Some(ref r) = body.role {
        let valid_roles = ["admin_garderie", "educateur", "parent"];
        if !valid_roles.contains(&r.as_str()) {
            return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Rôle invalide" }))));
        }
    }

    // Build dynamic UPDATE — only update provided fields
    let mut sets: Vec<String> = vec![];
    if body.first_name.is_some() { sets.push("first_name = $__".into()); }
    if body.last_name.is_some()  { sets.push("last_name = $__".into()); }
    if body.role.is_some()       { sets.push(format!("role = $__::\"{schema}\".user_role")); }
    if body.is_active.is_some()  { sets.push("is_active = $__".into()); }
    if body.preferred_locale.is_some() { sets.push("preferred_locale = $__".into()); }

    if sets.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Aucune modification fournie" }))));
    }

    // Replace $__ placeholders with sequential $n (starting at $2; $1 = id)
    let mut param_idx = 2usize;
    let sets_sql: Vec<String> = sets
        .iter()
        .map(|s| {
            let replaced = s.replace("$__", &format!("${param_idx}"));
            param_idx += 1;
            replaced
        })
        .collect();

    let sql = format!(
        "UPDATE {schema}.users SET {}, updated_at = NOW() WHERE id = $1 RETURNING id",
        sets_sql.join(", ")
    );

    let mut q = sqlx::query_scalar::<_, Uuid>(&sql).bind(target_id);
    if let Some(v) = &body.first_name      { q = q.bind(v); }
    if let Some(v) = &body.last_name       { q = q.bind(v); }
    if let Some(v) = &body.role            { q = q.bind(v); }
    if let Some(v) = body.is_active        { q = q.bind(v); }
    if let Some(v) = &body.preferred_locale { q = q.bind(v); }

    q.fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?
        .ok_or((StatusCode::NOT_FOUND, Json(json!({ "error": "Utilisateur introuvable" }))))?;

    audit::log(state.db.clone(), &tenant, AuditEntry {
        user_id:        Some(user.user_id),
        user_name:      None,
        action:         "user.update".to_string(),
        resource_type:  Some("user".to_string()),
        resource_id:    Some(target_id.to_string()),
        resource_label: body.role.as_deref().map(|r| format!("role → {r}")),
        ip_address:     "unknown".to_string(),
    });

    Ok(Json(json!({ "message": "Utilisateur mis à jour" })))
}

use crate::models::user::DeleteUserRequest;

/// Soft-delete: mark user as inactive. Requires admin password confirmation.
pub async fn deactivate_user(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(target_id): Path<Uuid>,
    Query(query): Query<DeleteQuery>,
    Json(body): Json<DeleteUserRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&user)?;

    // Prevent self-deactivation
    if target_id == user.user_id {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Impossible de se désactiver soi-même" }))));
    }

    // Verify admin's password
    let schema = schema_name(&tenant);
    tracing::info!("deactivate_user attempt: admin_id={} target_id={} tenant={} hard={}", user.user_id, target_id, tenant, query.hard.unwrap_or(false));
    let admin_hash: Option<String> = sqlx::query_scalar(&format!(
        "SELECT password_hash FROM {schema}.users WHERE id = $1 AND is_active = TRUE"
    ))
    .bind(user.user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("deactivate_user: db error fetching admin hash: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))
    })?;

    let admin_hash = match admin_hash {
        Some(h) => h,
        None => {
            tracing::warn!("deactivate_user: admin user not found in tenant schema: {}", user.user_id);
            return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Admin non trouvé" }))));
        }
    };

    match bcrypt::verify(&body.password, &admin_hash) {
        Ok(true) => tracing::info!("deactivate_user: password verified for admin_id={}", user.user_id),
        Ok(false) => {
            tracing::info!("deactivate_user: password mismatch for admin_id={}", user.user_id);
            return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Mot de passe incorrect" }))));
        }
        Err(e) => {
            tracing::error!("deactivate_user: bcrypt verify error for admin_id={}: {}", user.user_id, e);
            return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Mot de passe incorrect" }))));
        }
    }

    // Fetch target user info before deletion (for audit log)
    let target_info: Option<(String, String, String)> = sqlx::query_as(&format!(
        "SELECT first_name, last_name, email FROM {schema}.users WHERE id = $1"
    ))
    .bind(target_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    let (first_name, last_name, email) = match target_info {
        Some(info) => info,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Utilisateur non trouvé" })),
            ))
        }
    };

    let resource_label = format!("{} {} ({})", first_name, last_name, email);

    if query.hard.unwrap_or(false) {
        // Permanent deletion within tenant schema — FK ON DELETE CASCADE will handle most related rows.
        sqlx::query(&format!(
            "DELETE FROM {schema}.users WHERE id = $1"
        ))
        .bind(target_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

        audit::log(state.db.clone(), &tenant, AuditEntry {
            user_id:        Some(user.user_id),
            user_name:      Some(email.clone()),
            action:         "user.delete".to_string(),
            resource_type:  Some("user".to_string()),
            resource_id:    Some(target_id.to_string()),
            resource_label: Some(resource_label),
            ip_address:     "unknown".to_string(),
        });
        Ok(Json(json!({ "message": "Utilisateur supprimé définitivement" })))
    } else {
        sqlx::query(&format!(
            "UPDATE {schema}.users SET is_active = FALSE, updated_at = NOW() WHERE id = $1"
        ))
        .bind(target_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

        audit::log(state.db.clone(), &tenant, AuditEntry {
            user_id:        Some(user.user_id),
            user_name:      Some(email.clone()),
            action:         "user.deactivate".to_string(),
            resource_type:  Some("user".to_string()),
            resource_id:    Some(target_id.to_string()),
            resource_label: Some(resource_label),
            ip_address:     "unknown".to_string(),
        });
        Ok(Json(json!({ "message": "Utilisateur désactivé" })))
    }
}

use crate::models::user::{AdminResetPasswordRequest, AdminResetPasswordResponse};
use crate::services::auth::AuthService;

/// Admin resets a user's password via temp password or email link.
pub async fn reset_user_password(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(target_id): Path<Uuid>,
    Json(body): Json<AdminResetPasswordRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&user)?;

    let method = body.method.as_deref().unwrap_or("email");
    if !["email", "temp_password"].contains(&method) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Méthode invalide" }))));
    }

    let (message, temp_password) = AuthService::reset_user_password_as_admin(
        &state.db,
        state.email.as_deref(),
        &tenant,
        target_id,
        Some(method),
        &state.config.app_base_url,
    )
    .await
    .map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        )
    })?;

    let response = AdminResetPasswordResponse {
        message,
        temp_password,
    };

    Ok(Json(serde_json::to_value(response).unwrap()))
}

