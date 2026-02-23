use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, StatusCode},
    response::Response,
    Json,
};
use serde_json::{json, Value};
use std::path::PathBuf;

use crate::{
    middleware::tenant::TenantSlug,
    models::{auth::AuthenticatedUser, user::UserRole},
    AppState,
};

fn detect_image_ext(content_type: &str, filename: &str) -> Option<&'static str> {
    match content_type {
        "image/png" => return Some("png"),
        "image/jpeg" | "image/jpg" => return Some("jpg"),
        "image/webp" => return Some("webp"),
        "image/gif" => return Some("gif"),
        _ => {}
    }
    let ext = filename.rsplit('.').next()?.to_lowercase();
    match ext.as_str() {
        "png" => Some("png"),
        "jpg" | "jpeg" => Some("jpg"),
        "webp" => Some("webp"),
        "gif" => Some("gif"),
        _ => None,
    }
}

pub async fn upload_logo(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    mut multipart: Multipart,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !matches!(user.role, UserRole::AdminGarderie | UserRole::SuperAdmin) {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Forbidden" }))));
    }

    let logo_dir = PathBuf::from(&state.config.media_dir).join(&tenant);
    tokio::fs::create_dir_all(&logo_dir).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))
    })?;

    // Remove any existing logo file
    if let Ok(mut dir) = tokio::fs::read_dir(&logo_dir).await {
        while let Ok(Some(entry)) = dir.next_entry().await {
            let fname = entry.file_name().to_string_lossy().to_string();
            if fname.starts_with("logo.") {
                let _ = tokio::fs::remove_file(entry.path()).await;
            }
        }
    }

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (StatusCode::BAD_REQUEST, Json(json!({ "error": e.to_string() })))
    })? {
        let ct = field.content_type().unwrap_or("").to_string();
        let fname = field.file_name().unwrap_or("").to_string();

        let file_ext = detect_image_ext(&ct, &fname).ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Format non supporté. Utilisez PNG, JPG, WebP ou GIF." })),
            )
        })?;

        let data = field.bytes().await.map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))
        })?;

        if data.len() > 5 * 1024 * 1024 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Fichier trop volumineux (max 5 Mo)" })),
            ));
        }

        let file_path = logo_dir.join(format!("logo.{file_ext}"));
        tokio::fs::write(&file_path, &data).await.map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))
        })?;

        let logo_url = format!(
            "{}/api/logos/{}",
            state.config.app_base_url.trim_end_matches('/'),
            tenant
        );
        sqlx::query(
            "UPDATE garderies SET logo_url = $1, updated_at = NOW() WHERE slug = $2",
        )
        .bind(&logo_url)
        .bind(&tenant)
        .execute(&state.db)
        .await
        .map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))
        })?;

        return Ok(Json(json!({ "logo_url": logo_url })));
    }

    Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Aucun fichier fourni" }))))
}

pub async fn delete_logo(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !matches!(user.role, UserRole::AdminGarderie | UserRole::SuperAdmin) {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Forbidden" }))));
    }

    let logo_dir = PathBuf::from(&state.config.media_dir).join(&tenant);
    if let Ok(mut dir) = tokio::fs::read_dir(&logo_dir).await {
        while let Ok(Some(entry)) = dir.next_entry().await {
            let fname = entry.file_name().to_string_lossy().to_string();
            if fname.starts_with("logo.") {
                let _ = tokio::fs::remove_file(entry.path()).await;
            }
        }
    }

    sqlx::query(
        "UPDATE garderies SET logo_url = NULL, updated_at = NOW() WHERE slug = $1",
    )
    .bind(&tenant)
    .execute(&state.db)
    .await
    .map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() })))
    })?;

    Ok(Json(json!({ "ok": true })))
}

pub async fn serve_logo(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Response<Body>, StatusCode> {
    if slug.contains('/') || slug.contains("..") || slug.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let logo_dir = PathBuf::from(&state.config.media_dir).join(&slug);
    let mut found: Option<(PathBuf, String)> = None;

    if let Ok(mut dir) = tokio::fs::read_dir(&logo_dir).await {
        while let Ok(Some(entry)) = dir.next_entry().await {
            let fname = entry.file_name().to_string_lossy().to_string();
            if fname.starts_with("logo.") {
                found = Some((entry.path(), fname));
                break;
            }
        }
    }

    let (file_path, fname) = found.ok_or(StatusCode::NOT_FOUND)?;
    let ext = fname.rsplit('.').next().unwrap_or("").to_lowercase();

    let data = tokio::fs::read(&file_path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let content_type = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    };

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "public, max-age=3600")
        .body(Body::from(data))
        .unwrap())
}
