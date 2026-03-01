use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
    middleware::tenant::TenantSlug,
    models::{
        auth::AuthenticatedUser,
        child::{AssignParentRequest, CreateChildRequest, UpdateChildRequest},
        user::UserRole,
    },
    services::{audit::{self, AuditEntry}, children::ChildService},
    AppState,
};

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ExportJournal {
    id: Uuid,
    date: NaiveDate,
    temperature: Option<String>,
    menu: Option<String>,
    appetit: Option<String>,
    humeur: Option<String>,
    sommeil_minutes: Option<i16>,
    absent: bool,
    sante: Option<String>,
    medicaments: Option<String>,
    message_educatrice: Option<String>,
    observations: Option<String>,
    sent_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ExportMedia {
    id: Uuid,
    media_type: String,
    original_filename: String,
    caption: Option<String>,
    content_type: String,
    size_bytes: i64,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ExportParent {
    user_id: Uuid,
    first_name: String,
    last_name: String,
    email: String,
    relationship: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ExportConsent {
    id: Uuid,
    user_id: Uuid,
    privacy_accepted: bool,
    photos_accepted: bool,
    accepted_at: DateTime<Utc>,
    policy_version: String,
    language: String,
    created_at: DateTime<Utc>,
}

fn client_ip(h: &HeaderMap) -> String {
    h.get("x-real-ip").and_then(|v| v.to_str().ok())
        .or_else(|| h.get("x-forwarded-for").and_then(|v| v.to_str().ok())
            .and_then(|s| s.split(',').next()).map(|s| s.trim()))
        .unwrap_or("unknown")
        .to_string()
}

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
    headers: HeaderMap,
    user: AuthenticatedUser,
    Json(body): Json<CreateChildRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if let Some(err) = require_admin(&user) {
        return Err(err);
    }

    let result = ChildService::create(&state.db, &tenant, &body).await;

    if let Ok(ref child) = result {
        let label = format!("{} {}", child.first_name, child.last_name);
        audit::log(state.db.clone(), &tenant, AuditEntry {
            user_id:        Some(user.user_id),
            user_name:      None,
            action:         "child.create".to_string(),
            resource_type:  Some("child".to_string()),
            resource_id:    Some(child.id.to_string()),
            resource_label: Some(label),
            ip_address:     client_ip(&headers),
        });
    }

    result
        .map(|child| (StatusCode::CREATED, Json(serde_json::to_value(child).unwrap())))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))
}

pub async fn update_child(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    headers: HeaderMap,
    user: AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateChildRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = require_admin(&user) {
        return Err(err);
    }

    let result = ChildService::update(&state.db, &tenant, id, &body).await;

    if let Ok(ref child) = result {
        let label = format!("{} {}", child.first_name, child.last_name);
        audit::log(state.db.clone(), &tenant, AuditEntry {
            user_id:        Some(user.user_id),
            user_name:      None,
            action:         "child.update".to_string(),
            resource_type:  Some("child".to_string()),
            resource_id:    Some(child.id.to_string()),
            resource_label: Some(label),
            ip_address:     client_ip(&headers),
        });
    }

    result
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
    headers: HeaderMap,
    user: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = require_admin(&user) {
        return Err(err);
    }

    let result = ChildService::delete(&state.db, &tenant, id).await;

    if result.is_ok() {
        audit::log(state.db.clone(), &tenant, AuditEntry {
            user_id:        Some(user.user_id),
            user_name:      None,
            action:         "child.delete".to_string(),
            resource_type:  Some("child".to_string()),
            resource_id:    Some(id.to_string()),
            resource_label: None,
            ip_address:     client_ip(&headers),
        });
    }

    result
        .map(|_| Json(json!({ "message": "Enfant supprimé" })))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))
}

pub async fn export_child(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    headers: HeaderMap,
    user: AuthenticatedUser,
    Path(child_id): Path<Uuid>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Check access: Educateur cannot export, Parent must be parent of this child
    if let UserRole::Educateur = user.role {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Accès refusé" }))));
    }

    if let UserRole::Parent = user.role {
        match ChildService::is_parent_of(&state.db, &tenant, child_id, user.user_id).await {
            Ok(false) => return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Accès refusé" })))),
            Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))),
            _ => {}
        }
    }

    let schema = schema_name(&tenant);

    // Query 1: Get child profile
    let child: Value = match sqlx::query_scalar::<_, Value>(&format!(
        "SELECT row_to_json({schema}.children.*) FROM {schema}.children WHERE id = $1"
    ))
    .bind(child_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(val)) => val,
        Ok(None) => return Err((StatusCode::NOT_FOUND, Json(json!({ "error": "Enfant non trouvé" })))),
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))),
    };

    // Query 2: Get parents linked to this child
    let parents: Vec<ExportParent> = match sqlx::query_as::<_, ExportParent>(&format!(
        "SELECT u.id as user_id, u.first_name, u.last_name, u.email, cp.relationship
         FROM {schema}.child_parents cp
         JOIN {schema}.users u ON u.id = cp.user_id
         WHERE cp.child_id = $1
         ORDER BY u.last_name, u.first_name"
    ))
    .bind(child_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(p) => p,
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))),
    };

    // Query 3: Get journals
    let journals: Vec<ExportJournal> = match sqlx::query_as::<_, ExportJournal>(&format!(
        "SELECT id, date, temperature::TEXT, menu, appetit::TEXT, humeur::TEXT,
                sommeil_minutes, absent, sante, medicaments,
                message_educatrice, observations, sent_at, created_at
         FROM {schema}.daily_journals
         WHERE child_id = $1
         ORDER BY date DESC"
    ))
    .bind(child_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(j) => j,
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))),
    };

    // Query 4: Get media metadata
    let media: Vec<ExportMedia> = match sqlx::query_as::<_, ExportMedia>(&format!(
        "SELECT m.id, m.media_type::TEXT, m.original_filename, m.caption,
                m.content_type, m.size_bytes, m.created_at
         FROM {schema}.media m
         JOIN {schema}.media_children mc ON mc.media_id = m.id
         WHERE mc.child_id = $1
         ORDER BY m.created_at DESC"
    ))
    .bind(child_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(m) => m,
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))),
    };

    // Query 5: Get consents (if parents non-empty)
    let mut consents: Vec<ExportConsent> = vec![];
    if !parents.is_empty() {
        let parent_ids: Vec<Uuid> = parents.iter().map(|p| p.user_id).collect();
        consents = match sqlx::query_as::<_, ExportConsent>(&format!(
            "SELECT id, user_id, privacy_accepted, photos_accepted, accepted_at, policy_version, language, created_at
             FROM {schema}.consent_records
             WHERE user_id = ANY($1)
             ORDER BY accepted_at DESC"
        ))
        .bind(&parent_ids)
        .fetch_all(&state.db)
        .await
        {
            Ok(c) => c,
            Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))),
        };
    }

    // Audit log
    if let Value::Object(ref obj) = child {
        let label = format!(
            "{} {}",
            obj.get("first_name").and_then(|v| v.as_str()).unwrap_or(""),
            obj.get("last_name").and_then(|v| v.as_str()).unwrap_or("")
        );
        audit::log(state.db.clone(), &tenant, AuditEntry {
            user_id:        Some(user.user_id),
            user_name:      None,
            action:         "child.export".to_string(),
            resource_type:  Some("child".to_string()),
            resource_id:    Some(child_id.to_string()),
            resource_label: Some(label),
            ip_address:     client_ip(&headers),
        });
    }

    let export = json!({
        "exported_at": Utc::now().to_rfc3339(),
        "child": child,
        "parents": parents,
        "journals": journals,
        "media_metadata": media,
        "consents": consents,
    });

    Ok(Json(export))
}
