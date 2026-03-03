use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    db::tenant::{provision_tenant_schema, schema_name},
    middleware::super_admin::SuperAdminAuth,
    models::{tenant::CreateGarderieRequest, user::InviteUserRequest},
    services::auth::AuthService,
    AppState,
};

// ─── Garderie CRUD ────────────────────────────────────────────────────────────

pub async fn list_garderies(
    State(state): State<AppState>,
    _auth: SuperAdminAuth,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    sqlx::query_as::<_, crate::models::tenant::Garderie>(
        "SELECT * FROM garderies ORDER BY name",
    )
    .fetch_all(&state.db)
    .await
    .map(|items| Json(serde_json::to_value(items).unwrap()))
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))
}

pub async fn create_garderie(
    State(state): State<AppState>,
    _auth: SuperAdminAuth,
    Json(body): Json<CreateGarderieRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let garderie = sqlx::query_as::<_, crate::models::tenant::Garderie>(
        "INSERT INTO garderies (slug, name, address, phone, email, plan)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *",
    )
    .bind(&body.slug)
    .bind(&body.name)
    .bind(&body.address)
    .bind(&body.phone)
    .bind(&body.email)
    .bind(body.plan.unwrap_or(crate::models::tenant::PlanType::Free))
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    provision_tenant_schema(&state.db, &body.slug)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": format!("Schema provisioning failed: {e}") }))))?;

    Ok((StatusCode::CREATED, Json(serde_json::to_value(garderie).unwrap())))
}

pub async fn delete_garderie(
    State(state): State<AppState>,
    _auth: SuperAdminAuth,
    Path(slug): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let schema = schema_name(&slug);

    // Drop tenant schema (cascades to all tables/types/functions in it)
    sqlx::raw_sql(&format!("DROP SCHEMA IF EXISTS {schema} CASCADE"))
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    // Remove from garderies registry
    let deleted = sqlx::query("DELETE FROM garderies WHERE slug = $1")
        .bind(&slug)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    if deleted.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(json!({ "error": "Garderie introuvable" }))));
    }

    // Delete physical files (photos, videos, documents) for this tenant
    let tenant_media_dir = std::path::PathBuf::from(&state.config.media_dir).join(&slug);
    if tenant_media_dir.exists() {
        if let Err(e) = tokio::fs::remove_dir_all(&tenant_media_dir).await {
            // Log but don't fail — DB is already cleaned up
            tracing::warn!("Could not delete media directory {:?}: {}", tenant_media_dir, e);
        }
    }

    Ok(Json(json!({ "message": "Garderie supprimée" })))
}

pub async fn update_garderie(
    State(state): State<AppState>,
    _auth: SuperAdminAuth,
    Path(slug): Path<String>,
    Json(body): Json<UpdateGarderieRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    sqlx::query_as::<_, crate::models::tenant::Garderie>(
        "UPDATE garderies SET
           name    = COALESCE($2, name),
           address = COALESCE($3, address),
           phone   = COALESCE($4, phone),
           email   = COALESCE($5, email),
           is_active = COALESCE($6, is_active),
           trial_expires_at = CASE
               WHEN $7 = TRUE THEN NULL::TIMESTAMPTZ
               ELSE COALESCE($8, trial_expires_at)
           END,
           updated_at = NOW()
         WHERE slug = $1
         RETURNING *",
    )
    .bind(&slug)
    .bind(&body.name)
    .bind(&body.address)
    .bind(&body.phone)
    .bind(&body.email)
    .bind(body.is_active)
    .bind(body.remove_trial_expires.unwrap_or(false))
    .bind(body.trial_expires_at)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?
    .map(|g| Json(serde_json::to_value(g).unwrap()))
    .ok_or((StatusCode::NOT_FOUND, Json(json!({ "error": "Garderie not found" }))))
}

#[derive(Deserialize)]
pub struct UpdateGarderieRequest {
    pub name: Option<String>,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub is_active: Option<bool>,
    /// Set a new trial expiry date.
    pub trial_expires_at: Option<DateTime<Utc>>,
    /// If true, clears trial_expires_at to NULL (converts to permanent account).
    pub remove_trial_expires: Option<bool>,
}

// ─── Garderie user management (super-admin) ───────────────────────────────────

/// List all users belonging to a garderie's tenant schema.
pub async fn list_garderie_users(
    State(state): State<AppState>,
    _auth: SuperAdminAuth,
    Path(slug): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let schema = schema_name(&slug);

    let users = sqlx::query(&format!(
        "SELECT id, email, first_name, last_name, role::TEXT as role,
                is_active, preferred_locale, created_at
         FROM {schema}.users
         ORDER BY role, last_name, first_name"
    ))
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    let result: Vec<Value> = users
        .iter()
        .map(|row| {
            use sqlx::Row;
            json!({
                "id": row.get::<Uuid, _>("id").to_string(),
                "email": row.get::<String, _>("email"),
                "first_name": row.get::<String, _>("first_name"),
                "last_name": row.get::<String, _>("last_name"),
                "role": row.get::<String, _>("role"),
                "is_active": row.get::<bool, _>("is_active"),
                "preferred_locale": row.get::<String, _>("preferred_locale"),
            })
        })
        .collect();

    Ok(Json(json!(result)))
}

#[derive(Deserialize)]
pub struct CreateGarderieUserRequest {
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub password: String,
    pub role: Option<String>, // defaults to "admin_garderie"
    pub preferred_locale: Option<String>,
}

/// Create a user directly in a garderie's tenant schema (no invitation needed).
pub async fn create_garderie_user(
    State(_state): State<AppState>,
    _auth: SuperAdminAuth,
    Path(slug): Path<String>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    // Body extracted manually to work around Path + Json extractor ordering
    // (handled via separate extractor — see create_garderie_user_inner)
    let _ = slug;
    Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "use create_garderie_user_body" }))))
}

pub async fn create_garderie_user_body(
    State(state): State<AppState>,
    _auth: SuperAdminAuth,
    Path(slug): Path<String>,
    Json(body): Json<CreateGarderieUserRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let schema = schema_name(&slug);

    // Validate role
    let role = body.role.as_deref().unwrap_or("admin_garderie");
    let valid_roles = ["super_admin", "admin_garderie", "educateur", "parent"];
    if !valid_roles.contains(&role) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid role" }))));
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

/// Send an invitation email to a new user for a given garderie (super-admin).
pub async fn invite_garderie_user(
    State(state): State<AppState>,
    _auth: SuperAdminAuth,
    Path(slug): Path<String>,
    Json(body): Json<InviteUserRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    AuthService::create_invitation(
        &state.db,
        state.email.as_deref(),
        &slug,
        &body.email,
        body.role,
        None, // invited_by is null for super-admin invitations
        &state.config.app_base_url,
    )
    .await
    .map(|_| Json(json!({ "message": format!("Invitation envoyée à {}", body.email) })))
    .map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        )
    })
}

/// Deactivate (soft-delete) a user in a garderie's tenant schema.
pub async fn deactivate_garderie_user(
    State(state): State<AppState>,
    _auth: SuperAdminAuth,
    Path((slug, user_id)): Path<(String, Uuid)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let schema = schema_name(&slug);

    sqlx::query(&format!(
        "UPDATE {schema}.users SET is_active = FALSE, updated_at = NOW() WHERE id = $1"
    ))
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    Ok(Json(json!({ "message": "Utilisateur désactivé" })))
}

// ─── Global backup ────────────────────────────────────────────────────────────

pub async fn trigger_backup_all(
    State(state): State<AppState>,
    _auth: SuperAdminAuth,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let now = chrono::Utc::now();
    let timestamp = now.format("%Y%m%d_%H%M%S").to_string();

    let backup_dir = std::path::PathBuf::from("/backup/host/backups");
    tokio::fs::create_dir_all(&backup_dir).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": format!("Could not create backup dir: {}", e) }))))?;

    // Full DB dump (all schemas) — --clean adds DROP statements so restores are clean
    let db_file = backup_dir.join(format!("db_{}.sql.gz", timestamp));
    let db_output = tokio::process::Command::new("pg_dump")
        .arg("-d")
        .arg(&state.config.database_url)
        .arg("--clean")
        .arg("--if-exists")
        .arg("--compress=gzip")
        .arg("-f")
        .arg(&db_file)
        .output()
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "pg_dump command failed" }))))?;

    if !db_output.status.success() {
        let stderr = String::from_utf8_lossy(&db_output.stderr);
        tracing::error!("pg_dump failed: {}", stderr);
        return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": format!("pg_dump failed: {}", stderr.trim()) }))));
    }

    // Full media archive
    let mut media_file: Option<String> = None;
    let media_dir = std::path::PathBuf::from(&state.config.media_dir);
    if media_dir.exists() {
        let media_path = backup_dir.join(format!("media_{}.tar.gz", timestamp));
        let tar_output = tokio::process::Command::new("tar")
            .arg("-czf")
            .arg(&media_path)
            .arg("-C")
            .arg(media_dir.parent().unwrap_or(&media_dir))
            .arg(media_dir.file_name().unwrap_or_default())
            .output()
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": format!("tar failed: {}", e) }))))?;

        if !tar_output.status.success() {
            let stderr = String::from_utf8_lossy(&tar_output.stderr);
            tracing::error!("tar failed: {}", stderr);
            return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": format!("tar failed: {}", stderr.trim()) }))));
        }
        media_file = Some(media_path.to_string_lossy().to_string());
    }

    Ok(Json(json!({
        "status": "Backup completed",
        "files": {
            "db": db_file.to_string_lossy().to_string(),
            "media": media_file
        }
    })))
}

// ─── List & restore backups ───────────────────────────────────────────────────

fn extract_timestamp(filename: &str) -> Option<String> {
    // e.g. db_all_20260219_153023.sql.gz → 20260219_153023
    let stem = filename.splitn(2, '.').next()?;
    let parts: Vec<&str> = stem.split('_').collect();
    if parts.len() < 3 {
        return None;
    }
    let n = parts.len();
    let date = parts[n - 2];
    let time = parts[n - 1];
    if date.len() == 8 && time.len() == 6 && date.chars().all(|c| c.is_ascii_digit()) && time.chars().all(|c| c.is_ascii_digit()) {
        Some(format!("{}_{}", date, time))
    } else {
        None
    }
}

fn format_timestamp(ts: &str) -> String {
    if ts.len() != 15 {
        return ts.to_string();
    }
    format!(
        "{}-{}-{} {}:{}:{}",
        &ts[0..4], &ts[4..6], &ts[6..8],
        &ts[9..11], &ts[11..13], &ts[13..15]
    )
}

pub async fn list_backups(
    _state: State<AppState>,
    _auth: SuperAdminAuth,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let backup_dir = std::path::PathBuf::from("/backup/host/backups");

    let mut db_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut media_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    if backup_dir.exists() {
        let mut entries = tokio::fs::read_dir(&backup_dir).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

        while let Some(entry) = entries.next_entry().await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))? {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(ts) = extract_timestamp(&name) {
                if name.ends_with(".sql.gz") {
                    db_map.insert(ts, name);
                } else if name.ends_with(".tar.gz") {
                    media_map.insert(ts, name);
                }
            }
        }
    }

    // Merge into sorted list (newest first)
    let mut timestamps: Vec<String> = db_map.keys().cloned().collect();
    timestamps.sort_by(|a, b| b.cmp(a));

    let entries: Vec<Value> = timestamps.iter().map(|ts| {
        json!({
            "timestamp": ts,
            "date": format_timestamp(ts),
            "db_file": db_map.get(ts),
            "media_file": media_map.get(ts),
        })
    }).collect();

    Ok(Json(json!(entries)))
}

#[derive(Deserialize)]
pub struct RestoreRequest {
    pub db_file: String,
    pub media_file: Option<String>,
}

pub async fn trigger_restore(
    State(state): State<AppState>,
    _auth: SuperAdminAuth,
    Json(body): Json<RestoreRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let backup_dir = std::path::PathBuf::from("/backup/host/backups");

    // Validate filenames — no path traversal
    let invalid = |f: &str| f.contains('/') || f.contains("..") || f.contains('\0');
    if invalid(&body.db_file) || !body.db_file.ends_with(".sql.gz") {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid db_file" }))));
    }
    if let Some(ref mf) = body.media_file {
        if invalid(mf) || !mf.ends_with(".tar.gz") {
            return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid media_file" }))));
        }
    }

    let db_path = backup_dir.join(&body.db_file);
    if !db_path.exists() {
        return Err((StatusCode::NOT_FOUND, Json(json!({ "error": "DB backup file not found" }))));
    }

    // Restore DB: gunzip | psql
    let restore_cmd = format!(
        "gunzip -c '{}' | psql '{}'",
        db_path.display(),
        &state.config.database_url
    );
    let db_output = tokio::process::Command::new("sh")
        .arg("-c")
        .arg(&restore_cmd)
        .output()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": format!("restore failed: {}", e) }))))?;

    if !db_output.status.success() {
        let stderr = String::from_utf8_lossy(&db_output.stderr);
        tracing::error!("DB restore failed: {}", stderr);
        return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": format!("DB restore failed: {}", stderr.trim()) }))));
    }

    // Restore media if requested
    let mut media_restored = false;
    if let Some(media_file) = &body.media_file {
        let media_path = backup_dir.join(media_file);
        if !media_path.exists() {
            return Err((StatusCode::NOT_FOUND, Json(json!({ "error": "Media backup file not found" }))));
        }
        let tar_output = tokio::process::Command::new("tar")
            .arg("-xzf")
            .arg(&media_path)
            .arg("-C")
            .arg("/data")
            .output()
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": format!("tar failed: {}", e) }))))?;

        if !tar_output.status.success() {
            let stderr = String::from_utf8_lossy(&tar_output.stderr);
            tracing::error!("Media restore failed: {}", stderr);
            return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": format!("Media restore failed: {}", stderr.trim()) }))));
        }
        media_restored = true;
    }

    Ok(Json(json!({
        "status": "Restore completed",
        "db_file": body.db_file,
        "media_restored": media_restored,
    })))
}
