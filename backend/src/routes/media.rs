use axum::{
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::AsyncReadExt;
use uuid::Uuid;

use crate::{
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
    MediaService::upload(
        &state.db,
        &tenant,
        user.user_id,
        &state.config.media_dir,
        &state.config.encryption_master_key,
        multipart,
    )
    .await
    .map(|media| (StatusCode::CREATED, Json(serde_json::to_value(media).unwrap())))
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })
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

/// Serve a media file with HTTP range support (for video streaming).
/// Add ?download=1 to get Content-Disposition: attachment.
/// 
/// SECURED: Requires authentication and validates permissions based on visibility rules.
pub async fn serve_media(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
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

    // Extract storage_path from the full path (relative to media_dir)
    let storage_path = path.as_str();

    // Load file metadata and encryption info from database
    let is_staff = !matches!(user.role, UserRole::Parent);
    
    // Query the database to get file info and check permissions
    let file_info = sqlx::query!(
        r#"
        SELECT 
            m.id,
            m.is_encrypted,
            m.encryption_iv,
            m.encryption_tag,
            m.content_type,
            m.visibility,
            m.uploader_id,
            m.group_id
        FROM {schema}.media m
        WHERE m.storage_path = $1
           OR m.thumbnail_path = $1
        "#,
        storage_path,
        schema = format!("\"{}\"", tenant)
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": format!("database error: {}", e)}))
    ))?
    .ok_or_else(|| (
        StatusCode::NOT_FOUND,
        Json(json!({"error": "file not found in database"}))
    ))?;

    // Permission checks for parents
    if !is_staff {
        let visibility = file_info.visibility.as_str();
        
        // Check if parent has access based on visibility rules
        let has_access = match visibility {
            "private" => {
                // Only uploader can access
                file_info.uploader_id == user.user_id
            }
            "public" => {
                // All authenticated users in tenant can access
                true
            }
            "group" => {
                // Parents with children in the group can access
                if let Some(group_id) = file_info.group_id {
                    let has_child_in_group = sqlx::query_scalar!(
                        r#"
                        SELECT EXISTS(
                            SELECT 1 
                            FROM {schema}.child_parents cp
                            JOIN {schema}.children c ON cp.child_id = c.id
                            WHERE cp.parent_id = $1 
                              AND c.group_id = $2
                        ) as "exists!"
                        "#,
                        user.user_id,
                        group_id,
                        schema = format!("\"{}\"", tenant)
                    )
                    .fetch_one(&state.db)
                    .await
                    .map_err(|e| (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({"error": format!("permission check failed: {}", e)}))
                    ))?;
                    
                    has_child_in_group
                } else {
                    false
                }
            }
            "child" => {
                // Parents linked to specific children can access
                let has_linked_child = sqlx::query_scalar!(
                    r#"
                    SELECT EXISTS(
                        SELECT 1 
                        FROM {schema}.media_children mc
                        JOIN {schema}.child_parents cp ON mc.child_id = cp.child_id
                        WHERE mc.media_id = $1 
                          AND cp.parent_id = $2
                    ) as "exists!"
                    "#,
                    file_info.id,
                    user.user_id,
                    schema = format!("\"{}\"", tenant)
                )
                .fetch_one(&state.db)
                .await
                .map_err(|e| (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": format!("permission check failed: {}", e)}))
                ))?;
                
                has_linked_child
            }
            _ => false,
        };

        if !has_access {
            return Err((StatusCode::FORBIDDEN, Json(json!({"error": "access denied"}))));
        }
    }

    // Read file from disk
    let file_bytes = tokio::fs::read(&file_path)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, Json(json!({"error": "file not found on disk"}))))?;

    // Decrypt if encrypted
    let decrypted_bytes = if file_info.is_encrypted {
        let iv = file_info.encryption_iv.ok_or_else(|| (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "missing encryption IV"}))
        ))?;
        let tag = file_info.encryption_tag.ok_or_else(|| (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "missing encryption tag"}))
        ))?;

        // Decode master key from hex
        let master_key_bytes = hex::decode(&state.config.encryption_master_key)
            .map_err(|e| (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("invalid master key: {}", e)}))
            ))?;
        
        if master_key_bytes.len() != 32 {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "master key must be 32 bytes"}))
            ));
        }

        let mut master_key = [0u8; 32];
        master_key.copy_from_slice(&master_key_bytes);

        // Derive tenant-specific key
        let tenant_key = encryption::derive_tenant_key(&master_key, &tenant)
            .map_err(|e| (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("key derivation failed: {}", e)}))
            ))?;

        // Decrypt file
        encryption::decrypt_file(&file_bytes, &iv, &tag, &tenant_key)
            .map_err(|e| (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("decryption failed: {}", e)}))
            ))?
    } else {
        file_bytes
    };

    let file_size = decrypted_bytes.len() as u64;
    let content_type = file_info.content_type.as_str();
    let download = params.download.unwrap_or(0) != 0;

    // Handle Range request on decrypted data
    if let Some(range_header) = headers.get(header::RANGE) {
        let range_str = range_header.to_str().map_err(|_| (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "invalid range header"}))
        ))?;
        
        if let Some((start, end)) = parse_range(range_str, file_size) {
            let length = (end - start + 1) as usize;
            let chunk = decrypted_bytes[start as usize..=end as usize].to_vec();

            let mut builder = Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::CONTENT_LENGTH, length.to_string())
                .header(
                    header::CONTENT_RANGE,
                    format!("bytes {}-{}/{}", start, end, file_size),
                )
                .header(header::ACCEPT_RANGES, "bytes");

            if download {
                let fname = file_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("download");
                builder = builder.header(
                    header::CONTENT_DISPOSITION,
                    format!("attachment; filename=\"{}\"", fname),
                );
            }

            return Ok(builder.body(Body::from(chunk)).unwrap());
        }
    }

    // Full file response
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, file_size.to_string())
        .header(header::ACCEPT_RANGES, "bytes");

    if download {
        let fname = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("download");
        builder = builder.header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", fname),
        );
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
    match MediaService::update(&state.db, &tenant, id, user.user_id, is_staff, &req).await {
        Ok(Some(media)) => Ok(Json(serde_json::to_value(media).unwrap())),
        Ok(None) => Err((StatusCode::NOT_FOUND, Json(json!({ "error": "not found" })))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))),
    }
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
