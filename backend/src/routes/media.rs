use axum::{
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
    middleware::tenant::TenantSlug,
    models::{
        auth::AuthenticatedUser,
        media::{BulkMediaRequest, MediaQuery, UpdateMediaRequest},
        user::UserRole,
    },
    services::{encryption, media::MediaService},
    AppState,
};

pub async fn upload_media(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    multipart: Multipart,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let media = MediaService::upload(
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
        if media.visibility != "private" {
            let pool = state.db.clone();
            let tenant_c = tenant.clone();
            let visibility = media.visibility.clone();
            let group_id = media.group_id;
            let media_id = media.id;
            let media_type_str = media.media_type.clone();
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
                    format!("{scheme}://{tenant_c}.{domain}/fr/parent/media")
                } else {
                    format!("https://{tenant_c}.{base}/fr/parent/media")
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

                    "child" => sqlx::query_as(&format!(
                        "SELECT DISTINCT u.id, u.email, CONCAT(u.first_name, ' ', u.last_name)
                         FROM {s}.users u
                         JOIN {s}.child_parents cp ON cp.user_id = u.id
                         JOIN {s}.media_children mc ON mc.child_id = cp.child_id
                         WHERE mc.media_id = $1 AND u.is_active = TRUE"
                    ))
                    .bind(media_id)
                    .fetch_all(&pool)
                    .await
                    .unwrap_or_default(),

                    _ => vec![],
                };

                let content_kind = if media_type_str == "video" {
                    "une vidéo"
                } else {
                    "de nouvelles photos"
                };

                for (parent_id, email, name) in recipients {
                    let cooldown_key =
                        format!("notif_cooldown:{tenant_c}:media_upload:{parent_id}");
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
                                content_kind,
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

    Ok((StatusCode::CREATED, Json(serde_json::to_value(media).unwrap())))
}

pub async fn list_media(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Query(query): Query<MediaQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let is_staff = !matches!(user.role, UserRole::Parent);
    MediaService::list(&state.db, &tenant, user.user_id, is_staff, &query)
        .await
        .map(|items| Json(serde_json::to_value(items).unwrap()))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}

#[derive(Deserialize)]
pub struct ServeMediaQuery {
    pub download: Option<u8>,
}

/// Serve a media or document file with HTTP range support (for video streaming).
/// Add ?download=1 to get Content-Disposition: attachment.
///
/// No auth header required — file paths contain opaque UUIDs and files are
/// encrypted at rest, so the path itself acts as the access token.
pub async fn serve_media(
    State(state): State<AppState>,
    Path(path): Path<String>,
    Query(params): Query<ServeMediaQuery>,
    headers: HeaderMap,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let file_path = std::path::PathBuf::from(&state.config.media_dir).join(&path);

    // Security: ensure the path doesn't escape the media directory
    let canonical_media = std::fs::canonicalize(&state.config.media_dir)
        .map_err(|_| (StatusCode::NOT_FOUND, Json(json!({"error": "media directory not found"}))))?;
    let canonical_file = match std::fs::canonicalize(&file_path) {
        Ok(p) => p,
        Err(_) => return Err((StatusCode::NOT_FOUND, Json(json!({"error": "file not found"})))),
    };
    if !canonical_file.starts_with(&canonical_media) {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "invalid path"}))));
    }

    // Extract tenant slug from the first path segment (e.g. "gbtest/2026/02/uuid.jpg" → "gbtest")
    let tenant_slug = path
        .split('/')
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "invalid path"}))))?;
    let schema = schema_name(tenant_slug);
    let storage_path = path.as_str();

    // --- Look up encryption metadata in media table ---
    #[derive(sqlx::FromRow)]
    struct MediaRow {
        is_encrypted: bool,
        encryption_iv: Option<Vec<u8>>,
        encryption_tag: Option<Vec<u8>>,
        thumbnail_encryption_iv: Option<Vec<u8>>,
        thumbnail_encryption_tag: Option<Vec<u8>>,
        content_type: String,
        storage_path: String,
    }

    let media_row = sqlx::query_as::<_, MediaRow>(&format!(
        r#"
        SELECT m.is_encrypted, m.encryption_iv, m.encryption_tag,
               m.thumbnail_encryption_iv, m.thumbnail_encryption_tag,
               m.content_type, m.storage_path
        FROM "{schema}".media m
        WHERE m.storage_path = $1 OR m.thumbnail_path = $1
        "#,
        schema = schema
    ))
    .bind(storage_path)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": format!("database error: {}", e)})),
    ))?;

    // Determine (is_encrypted, iv, tag, content_type) from media or documents
    let (is_encrypted, enc_iv, enc_tag, content_type) = if let Some(row) = media_row {
        // Is this request for the thumbnail or the main file?
        let is_thumbnail = row.storage_path != storage_path;
        if is_thumbnail {
            (row.is_encrypted, row.thumbnail_encryption_iv, row.thumbnail_encryption_tag, "image/jpeg".to_string())
        } else {
            (row.is_encrypted, row.encryption_iv, row.encryption_tag, row.content_type)
        }
    } else {
        // Fall back to documents table
        #[derive(sqlx::FromRow)]
        struct DocRow {
            is_encrypted: bool,
            encryption_iv: Option<Vec<u8>>,
            encryption_tag: Option<Vec<u8>>,
            content_type: String,
        }

        let doc = sqlx::query_as::<_, DocRow>(&format!(
            r#"
            SELECT d.is_encrypted, d.encryption_iv, d.encryption_tag, d.content_type
            FROM "{schema}".documents d
            WHERE d.storage_path = $1
            "#,
            schema = schema
        ))
        .bind(storage_path)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": format!("database error: {}", e)})),
        ))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "file not found in database"}))))?;

        (doc.is_encrypted, doc.encryption_iv, doc.encryption_tag, doc.content_type)
    };

    // Read file from disk
    let file_bytes = tokio::fs::read(&file_path)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, Json(json!({"error": "file not found on disk"}))))?;

    // Decrypt if needed
    let decrypted_bytes = if is_encrypted {
        let iv = enc_iv.ok_or_else(|| (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "missing encryption IV"})),
        ))?;
        let tag = enc_tag.ok_or_else(|| (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "missing encryption tag"})),
        ))?;

        let master_key_bytes = hex::decode(&state.config.encryption_master_key)
            .map_err(|e| (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("invalid master key: {}", e)})),
            ))?;
        if master_key_bytes.len() != 32 {
            return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "master key must be 32 bytes"}))));
        }
        let mut master_key = [0u8; 32];
        master_key.copy_from_slice(&master_key_bytes);

        let tenant_key = encryption::derive_tenant_key(&master_key, tenant_slug)
            .map_err(|e| (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("key derivation failed: {}", e)})),
            ))?;

        encryption::decrypt_file(&file_bytes, &iv, &tag, &tenant_key)
            .map_err(|e| (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("decryption failed: {}", e)})),
            ))?
    } else {
        file_bytes
    };

    let file_size = decrypted_bytes.len() as u64;
    let download = params.download.unwrap_or(0) != 0;

    // Handle Range request (video streaming)
    if let Some(range_header) = headers.get(header::RANGE) {
        let range_str = range_header
            .to_str()
            .map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({"error": "invalid range header"}))))?;

        if let Some((start, end)) = parse_range(range_str, file_size) {
            let length = (end - start + 1) as usize;
            let chunk = decrypted_bytes[start as usize..=end as usize].to_vec();

            let mut builder = Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, content_type.as_str())
                .header(header::CONTENT_LENGTH, length.to_string())
                .header(header::CONTENT_RANGE, format!("bytes {}-{}/{}", start, end, file_size))
                .header(header::ACCEPT_RANGES, "bytes");

            if download {
                let fname = file_path.file_name().and_then(|n| n.to_str()).unwrap_or("download");
                builder = builder.header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", fname));
            }
            return Ok(builder.body(Body::from(chunk)).unwrap());
        }
    }

    // Full file response
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type.as_str())
        .header(header::CONTENT_LENGTH, file_size.to_string())
        .header(header::ACCEPT_RANGES, "bytes");

    if download {
        let fname = file_path.file_name().and_then(|n| n.to_str()).unwrap_or("download");
        builder = builder.header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", fname));
    }

    Ok(builder.body(Body::from(decrypted_bytes)).unwrap())
}

pub async fn update_media(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateMediaRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let is_staff = !matches!(user.role, UserRole::Parent);
    let media = match MediaService::update(&state.db, &tenant, id, user.user_id, is_staff, &req).await {
        Ok(Some(m)) => m,
        Ok(None) => return Err((StatusCode::NOT_FOUND, Json(json!({ "error": "not found" })))),
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))),
    };

    // Notify parents when media becomes visible (visibility != private)
    if tenant != "demo" {
    if let Some(email_svc) = state.email.clone() {
        if media.visibility != "private" {
            let pool = state.db.clone();
            let tenant_c = tenant.clone();
            let visibility = media.visibility.clone();
            let group_id = media.group_id;
            let media_id = media.id;
            let media_type_str = media.media_type.clone();
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
                    format!("{scheme}://{tenant_c}.{domain}/fr/parent/media")
                } else {
                    format!("https://{tenant_c}.{base}/fr/parent/media")
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

                    "child" => sqlx::query_as(&format!(
                        "SELECT DISTINCT u.id, u.email, CONCAT(u.first_name, ' ', u.last_name)
                         FROM {s}.users u
                         JOIN {s}.child_parents cp ON cp.user_id = u.id
                         JOIN {s}.media_children mc ON mc.child_id = cp.child_id
                         WHERE mc.media_id = $1 AND u.is_active = TRUE"
                    ))
                    .bind(media_id)
                    .fetch_all(&pool)
                    .await
                    .unwrap_or_default(),

                    _ => vec![],
                };

                let content_kind = if media_type_str == "video" {
                    "une vidéo"
                } else {
                    "de nouvelles photos"
                };

                for (parent_id, email, name) in recipients {
                    let cooldown_key =
                        format!("notif_cooldown:{tenant_c}:media_upload:{parent_id}");
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
                                content_kind,
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

    Ok(Json(serde_json::to_value(media).unwrap()))
}

pub async fn delete_media(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    let is_staff = !matches!(user.role, UserRole::Parent);
    match MediaService::delete(&state.db, &tenant, id, user.user_id, is_staff, &state.config.media_dir).await {
        Ok(true) => Ok(StatusCode::NO_CONTENT),
        Ok(false) => Err((StatusCode::NOT_FOUND, Json(json!({ "error": "not found" })))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))),
    }
}

pub async fn bulk_media(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Json(req): Json<BulkMediaRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Only staff can perform bulk operations
    if matches!(user.role, UserRole::Parent) {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "forbidden" }))));
    }

    match MediaService::bulk(&state.db, &tenant, &req, &state.config.media_dir).await {
        Ok(count) => Ok(Json(json!({ "affected": count }))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))),
    }
}

fn parse_range(range: &str, file_size: u64) -> Option<(u64, u64)> {
    let range = range.strip_prefix("bytes=")?;
    let mut parts = range.split('-');
    let start: u64 = parts.next()?.parse().ok()?;
    let end: u64 = parts
        .next()
        .and_then(|e| e.parse().ok())
        .unwrap_or(file_size - 1);
    if start > end || end >= file_size {
        return None;
    }
    Some((start, end))
}
