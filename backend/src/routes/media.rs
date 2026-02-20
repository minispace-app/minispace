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
    services::media::MediaService,
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
pub async fn serve_media(
    State(state): State<AppState>,
    Path(path): Path<String>,
    Query(params): Query<ServeMediaQuery>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    let file_path = std::path::PathBuf::from(&state.config.media_dir).join(&path);

    // Security: ensure the path doesn't escape the media directory
    let canonical_media = std::fs::canonicalize(&state.config.media_dir)
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let canonical_file = match std::fs::canonicalize(&file_path) {
        Ok(p) => p,
        Err(_) => return Err(StatusCode::NOT_FOUND),
    };
    if !canonical_file.starts_with(&canonical_media) {
        return Err(StatusCode::FORBIDDEN);
    }

    let metadata = tokio::fs::metadata(&file_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let file_size = metadata.len();

    let content_type = mime_guess::from_path(&file_path)
        .first_raw()
        .unwrap_or("application/octet-stream");

    let download = params.download.unwrap_or(0) != 0;

    // Handle Range request
    if let Some(range_header) = headers.get(header::RANGE) {
        let range_str = range_header.to_str().map_err(|_| StatusCode::BAD_REQUEST)?;
        if let Some(range) = parse_range(range_str, file_size) {
            let (start, end) = range;
            let length = end - start + 1;

            let mut file = tokio::fs::File::open(&file_path)
                .await
                .map_err(|_| StatusCode::NOT_FOUND)?;

            use tokio::io::AsyncSeekExt;
            file.seek(std::io::SeekFrom::Start(start))
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let mut buf = vec![0u8; length as usize];
            file.read_exact(&mut buf)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

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

            return Ok(builder.body(Body::from(buf)).unwrap());
        }
    }

    // Full file
    let file_bytes = tokio::fs::read(&file_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

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

    Ok(builder.body(Body::from(file_bytes)).unwrap())
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
