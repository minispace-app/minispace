use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
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
    let doc = DocumentService::upload(
        &state.db,
        &tenant,
        user.user_id,
        &state.config.media_dir,
        &state.config.encryption_master_key,
        multipart,
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    // Email notifications aux parents concernés (async, non-bloquant, cooldown 1h par parent)
    if tenant != "demo" {
    if let Some(email_svc) = state.email.clone() {
        if doc.visibility != "private" {
            let pool = state.db.clone();
            let tenant_c = tenant.clone();
            let visibility = doc.visibility.clone();
            let group_id = doc.group_id;
            let child_id = doc.child_id;
            let uploader_id = user.user_id;
            let mut redis = state.redis.clone();
            let base = state.config.app_base_url.clone();

            tokio::spawn(async move {
                let s = schema_name(&tenant_c);

                let (garderie_name, logo_url): (String, Option<String>) = sqlx::query_as(
                    "SELECT name, logo_url FROM public.garderies WHERE slug = $1",
                )
                .bind(&tenant_c)
                .fetch_optional(&pool)
                .await
                .unwrap_or_default()
                .unwrap_or_else(|| (tenant_c.clone(), None));
                let logo_url = logo_url.unwrap_or_default();

                let uploader_name: String = sqlx::query_scalar(&format!(
                    "SELECT CONCAT(first_name, ' ', last_name) FROM {s}.users WHERE id = $1"
                ))
                .bind(uploader_id)
                .fetch_optional(&pool)
                .await
                .unwrap_or_default()
                .unwrap_or_else(|| "Un éducateur".to_string());

                let app_url = if let Some(idx) = base.find("://") {
                    let scheme = &base[..idx];
                    let domain = &base[idx + 3..];
                    format!("{scheme}://{tenant_c}.{domain}/fr/parent/documents")
                } else {
                    format!("https://{tenant_c}.{base}/fr/parent/documents")
                };

                let recipients: Vec<(Uuid, String, String)> = match visibility.as_str() {
                    "public" => sqlx::query_as(&format!(
                        "SELECT id, email, CONCAT(first_name, ' ', last_name)
                         FROM {s}.users WHERE role::text = 'parent' AND is_active = TRUE"
                    ))
                    .fetch_all(&pool)
                    .await
                    .unwrap_or_default(),

                    "group" => match group_id {
                        Some(gid) => sqlx::query_as(&format!(
                            "SELECT DISTINCT u.id, u.email, CONCAT(u.first_name, ' ', u.last_name)
                             FROM {s}.users u
                             JOIN {s}.child_parents cp ON cp.user_id = u.id
                             JOIN {s}.children c ON c.id = cp.child_id
                             WHERE c.group_id = $1 AND u.is_active = TRUE"
                        ))
                        .bind(gid)
                        .fetch_all(&pool)
                        .await
                        .unwrap_or_default(),
                        None => vec![],
                    },

                    "child" => match child_id {
                        Some(cid) => sqlx::query_as(&format!(
                            "SELECT DISTINCT u.id, u.email, CONCAT(u.first_name, ' ', u.last_name)
                             FROM {s}.users u
                             JOIN {s}.child_parents cp ON cp.user_id = u.id
                             WHERE cp.child_id = $1 AND u.is_active = TRUE"
                        ))
                        .bind(cid)
                        .fetch_all(&pool)
                        .await
                        .unwrap_or_default(),
                        None => vec![],
                    },

                    _ => vec![],
                };

                for (parent_id, email, name) in recipients {
                    let cooldown_key =
                        format!("notif_cooldown:{tenant_c}:doc_upload:{parent_id}");
                    let newly_set: Option<String> = redis::cmd("SET")
                        .arg(&cooldown_key)
                        .arg("1")
                        .arg("NX")
                        .arg("EX")
                        .arg(3600u64) // 1 heure
                        .query_async(&mut redis)
                        .await
                        .unwrap_or(None);

                    if newly_set.is_some() {
                        let _ = email_svc
                            .send_media_notification(
                                &email,
                                &name,
                                &uploader_name,
                                "un nouveau document",
                                &app_url,
                                &garderie_name,
                                &logo_url,
                            )
                            .await;
                    }
                }
            });
        }
    }
    } // end if tenant != "demo"

    crate::services::metrics::DOCUMENT_UPLOADS_COUNTER.with_label_values(&[&tenant]).inc();
    Ok((StatusCode::CREATED, Json(serde_json::to_value(doc).unwrap())))
}

pub async fn update_document(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateDocumentRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let is_staff = !matches!(user.role, UserRole::Parent);
    let doc = match DocumentService::update(&state.db, &tenant, id, user.user_id, is_staff, &req).await {
        Ok(Some(d)) => d,
        Ok(None) => return Err((StatusCode::NOT_FOUND, Json(json!({ "error": "not found" })))),
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))),
    };

    // Notify parents when document becomes visible (visibility != private)
    if tenant != "demo" {
    if let Some(email_svc) = state.email.clone() {
        if doc.visibility != "private" {
            let pool = state.db.clone();
            let tenant_c = tenant.clone();
            let visibility = doc.visibility.clone();
            let group_id = doc.group_id;
            let child_id = doc.child_id;
            let uploader_id = user.user_id;
            let mut redis = state.redis.clone();
            let base = state.config.app_base_url.clone();

            tokio::spawn(async move {
                let s = schema_name(&tenant_c);

                let (garderie_name, logo_url): (String, Option<String>) = sqlx::query_as(
                    "SELECT name, logo_url FROM public.garderies WHERE slug = $1",
                )
                .bind(&tenant_c)
                .fetch_optional(&pool)
                .await
                .unwrap_or_default()
                .unwrap_or_else(|| (tenant_c.clone(), None));
                let logo_url = logo_url.unwrap_or_default();

                let uploader_name: String = sqlx::query_scalar(&format!(
                    "SELECT CONCAT(first_name, ' ', last_name) FROM {s}.users WHERE id = $1"
                ))
                .bind(uploader_id)
                .fetch_optional(&pool)
                .await
                .unwrap_or_default()
                .unwrap_or_else(|| "Un éducateur".to_string());

                let app_url = if let Some(idx) = base.find("://") {
                    let scheme = &base[..idx];
                    let domain = &base[idx + 3..];
                    format!("{scheme}://{tenant_c}.{domain}/fr/parent/documents")
                } else {
                    format!("https://{tenant_c}.{base}/fr/parent/documents")
                };

                let recipients: Vec<(Uuid, String, String)> = match visibility.as_str() {
                    "public" => sqlx::query_as(&format!(
                        "SELECT id, email, CONCAT(first_name, ' ', last_name)
                         FROM {s}.users WHERE role::text = 'parent' AND is_active = TRUE"
                    ))
                    .fetch_all(&pool)
                    .await
                    .unwrap_or_default(),

                    "group" => match group_id {
                        Some(gid) => sqlx::query_as(&format!(
                            "SELECT DISTINCT u.id, u.email, CONCAT(u.first_name, ' ', u.last_name)
                             FROM {s}.users u
                             JOIN {s}.child_parents cp ON cp.user_id = u.id
                             JOIN {s}.children c ON c.id = cp.child_id
                             WHERE c.group_id = $1 AND u.is_active = TRUE"
                        ))
                        .bind(gid)
                        .fetch_all(&pool)
                        .await
                        .unwrap_or_default(),
                        None => vec![],
                    },

                    "child" => match child_id {
                        Some(cid) => sqlx::query_as(&format!(
                            "SELECT DISTINCT u.id, u.email, CONCAT(u.first_name, ' ', u.last_name)
                             FROM {s}.users u
                             JOIN {s}.child_parents cp ON cp.user_id = u.id
                             WHERE cp.child_id = $1 AND u.is_active = TRUE"
                        ))
                        .bind(cid)
                        .fetch_all(&pool)
                        .await
                        .unwrap_or_default(),
                        None => vec![],
                    },

                    _ => vec![],
                };

                for (parent_id, email, name) in recipients {
                    let cooldown_key =
                        format!("notif_cooldown:{tenant_c}:doc_upload:{parent_id}");
                    let newly_set: Option<String> = redis::cmd("SET")
                        .arg(&cooldown_key)
                        .arg("1")
                        .arg("NX")
                        .arg("EX")
                        .arg(3600u64)
                        .query_async(&mut redis)
                        .await
                        .unwrap_or(None);

                    if newly_set.is_some() {
                        let _ = email_svc
                            .send_media_notification(
                                &email,
                                &name,
                                &uploader_name,
                                "un nouveau document",
                                &app_url,
                                &garderie_name,
                                &logo_url,
                            )
                            .await;
                    }
                }
            });
        }
    }
    } // end if tenant != "demo"

    Ok(Json(serde_json::to_value(doc).unwrap()))
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
