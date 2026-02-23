use std::path::{Path, PathBuf};

use axum::extract::Multipart;
use chrono::{Datelike, NaiveDate, Utc};
use image::imageops::FilterType;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
    models::media::{BulkMediaRequest, Media, MediaQuery, MediaType, UpdateMediaRequest},
    services::encryption,
};

/// Explicit column list for Media — casts enums to TEXT, includes child_ids subquery.
/// All queries must alias the media table as `m`.
fn media_cols(schema: &str) -> String {
    format!(
        "m.id, m.uploader_id, m.media_type::TEXT as media_type, m.original_filename, m.storage_path,
         m.thumbnail_path, m.content_type, m.size_bytes, m.width, m.height, m.duration_secs,
         m.group_id, m.child_id, m.caption, m.visibility::TEXT as visibility,
         ARRAY(SELECT mc.child_id FROM \"{schema}\".media_children mc WHERE mc.media_id = m.id) as child_ids,
         m.created_at, m.is_encrypted, m.encryption_iv, m.encryption_tag,
         m.thumbnail_encryption_iv, m.thumbnail_encryption_tag"
    )
}

pub struct MediaService;

impl MediaService {
    pub async fn upload(
        pool: &PgPool,
        tenant: &str,
        uploader_id: Uuid,
        media_dir: &str,
        encryption_master_key: &str,
        mut multipart: Multipart,
    ) -> anyhow::Result<Media> {
        let now = Utc::now();
        let year = now.format("%Y").to_string();
        let month = now.format("%m").to_string();

        let tenant_dir = PathBuf::from(media_dir)
            .join(tenant)
            .join(&year)
            .join(&month);
        tokio::fs::create_dir_all(&tenant_dir).await?;

        let mut file_data: Option<(Vec<u8>, String, String)> = None;
        let mut caption: Option<String> = None;
        let mut group_id: Option<Uuid> = None;
        let mut child_ids: Vec<Uuid> = Vec::new();
        let mut visibility = "private".to_string();

        while let Some(field) = multipart.next_field().await? {
            let name = field.name().unwrap_or("").to_string();
            match name.as_str() {
                "file" => {
                    let filename = field.file_name().unwrap_or("upload").to_string();
                    let content_type = field
                        .content_type()
                        .unwrap_or("application/octet-stream")
                        .to_string();
                    let bytes = field.bytes().await?.to_vec();
                    file_data = Some((bytes, filename, content_type));
                }
                "caption" => {
                    caption = Some(field.text().await?);
                }
                "group_id" => {
                    group_id = field.text().await?.parse().ok();
                }
                "visibility" => {
                    visibility = field.text().await?;
                }
                // Accept "child_ids[]" or "child_ids" (multiple values)
                n if n == "child_ids[]" || n == "child_ids" => {
                    if let Ok(id) = field.text().await?.parse::<Uuid>() {
                        child_ids.push(id);
                    }
                }
                _ => {}
            }
        }

        let (bytes, original_filename, content_type) =
            file_data.ok_or_else(|| anyhow::anyhow!("No file field in upload"))?;

        let media_type = if content_type.starts_with("video/") {
            MediaType::Video
        } else {
            MediaType::Photo
        };

        let ext = Path::new(&original_filename)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin");

        let file_id = Uuid::new_v4();
        let storage_filename = format!("{}.{}", file_id, ext);
        let storage_path_full = tenant_dir.join(&storage_filename);
        let storage_path_rel = format!("{}/{}/{}/{}", tenant, year, month, storage_filename);

        // Decode master key and derive tenant key
        let master_key_bytes = hex::decode(encryption_master_key)?;
        if master_key_bytes.len() != 32 {
            anyhow::bail!("Master key must be 32 bytes");
        }
        let mut master_key = [0u8; 32];
        master_key.copy_from_slice(&master_key_bytes);
        let tenant_key = encryption::derive_tenant_key(&master_key, tenant)?;

        // Encrypt file data
        let (encrypted_bytes, iv, tag) = encryption::encrypt_file(&bytes, &tenant_key)?;

        // Write encrypted file to disk
        tokio::fs::write(&storage_path_full, &encrypted_bytes).await?;

        let (width, height, thumbnail_path, thumb_iv, thumb_tag) = if media_type == MediaType::Photo {
            Self::process_image(&bytes, &tenant_dir, file_id, &storage_path_rel, &tenant_key)
                .await
                .unwrap_or((None, None, None, None, None))
        } else {
            (None, None, None, None, None)
        };

        // Resolve group_id based on visibility
        let db_group_id = if visibility == "group" { group_id } else { None };

        let schema = schema_name(tenant);
        let cols = media_cols(&schema);

        // INSERT with encryption metadata
        let (inserted_id,): (Uuid,) = sqlx::query_as(&format!(
            "INSERT INTO \"{schema}\".media
             (uploader_id, media_type, original_filename, storage_path, thumbnail_path,
              content_type, size_bytes, width, height, group_id, child_id, caption, visibility,
              is_encrypted, encryption_iv, encryption_tag, thumbnail_encryption_iv, thumbnail_encryption_tag)
             VALUES ($1, $2::\"{schema}\".media_type, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::\"{schema}\".media_visibility, $14, $15, $16, $17, $18)
             RETURNING id"
        ))
        .bind(uploader_id)
        .bind(media_type.to_string())
        .bind(&original_filename)
        .bind(&storage_path_rel)
        .bind(&thumbnail_path)
        .bind(&content_type)
        .bind(encrypted_bytes.len() as i64) // Size of encrypted data
        .bind(width)
        .bind(height)
        .bind(db_group_id)
        .bind(Option::<Uuid>::None) // child_id legacy column unused
        .bind(caption)
        .bind(&visibility)
        .bind(true) // is_encrypted
        .bind(&iv)
        .bind(&tag)
        .bind(&thumb_iv)
        .bind(&thumb_tag)
        .fetch_one(pool)
        .await?;

        // Insert media_children entries
        for child_id in &child_ids {
            sqlx::query(&format!(
                "INSERT INTO \"{schema}\".media_children (media_id, child_id) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING"
            ))
            .bind(inserted_id)
            .bind(child_id)
            .execute(pool)
            .await?;
        }

        // Fetch full record with child_ids populated
        let media = sqlx::query_as::<_, Media>(&format!(
            "SELECT {cols} FROM \"{schema}\".media m WHERE m.id = $1"
        ))
        .bind(inserted_id)
        .fetch_one(pool)
        .await?;

        Ok(media)
    }

    async fn process_image(
        bytes: &[u8],
        dir: &Path,
        file_id: Uuid,
        storage_path_rel: &str,
        tenant_key: &[u8; 32],
    ) -> anyhow::Result<(Option<i32>, Option<i32>, Option<String>, Option<Vec<u8>>, Option<Vec<u8>>)> {
        let img = image::load_from_memory(bytes)?;
        let (width, height) = (img.width() as i32, img.height() as i32);

        let thumb = img.resize(400, 400, FilterType::Lanczos3);
        let thumb_filename = format!("{}_thumb.jpg", file_id);
        let thumb_path = dir.join(&thumb_filename);
        
        // Save thumbnail to memory buffer first
        let mut thumb_bytes = Vec::new();
        thumb.write_to(&mut std::io::Cursor::new(&mut thumb_bytes), image::ImageFormat::Jpeg)?;
        
        // Encrypt thumbnail
        let (encrypted_thumb, thumb_iv, thumb_tag) = encryption::encrypt_file(&thumb_bytes, tenant_key)?;
        
        // Write encrypted thumbnail to disk
        tokio::fs::write(&thumb_path, &encrypted_thumb).await?;

        let parts: Vec<&str> = storage_path_rel.rsplitn(2, '/').collect();
        let thumb_rel = if parts.len() == 2 {
            format!("{}/{}", parts[1], thumb_filename)
        } else {
            thumb_filename
        };

        Ok((Some(width), Some(height), Some(thumb_rel), Some(thumb_iv), Some(thumb_tag)))
    }

    /// Parse a period + date into (date_from, date_to) as ISO strings for SQL.
    fn period_range(period: &str, date_str: Option<&str>) -> Option<(NaiveDate, NaiveDate)> {
        let base = date_str
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
            .unwrap_or_else(|| Utc::now().date_naive());

        match period {
            "day" => {
                let next = base.succ_opt()?;
                Some((base, next))
            }
            "week" => {
                // Monday of the week
                let weekday_num = base.weekday().num_days_from_monday(); // 0=Mon
                let monday = base - chrono::Duration::days(weekday_num as i64);
                let sunday_next = monday + chrono::Duration::days(7);
                Some((monday, sunday_next))
            }
            "month" => {
                let first = base.with_day(1)?;
                let next_month = if base.month() == 12 {
                    NaiveDate::from_ymd_opt(base.year() + 1, 1, 1)?
                } else {
                    NaiveDate::from_ymd_opt(base.year(), base.month() + 1, 1)?
                };
                Some((first, next_month))
            }
            _ => None,
        }
    }

    pub async fn list(
        pool: &PgPool,
        tenant: &str,
        user_id: Uuid,
        is_staff: bool,
        query: &MediaQuery,
    ) -> anyhow::Result<Vec<Media>> {
        let schema = schema_name(tenant);
        let cols = media_cols(&schema);
        let per_page = query.per_page.unwrap_or(50).clamp(1, 200);
        let offset = (query.page.unwrap_or(1).max(1) - 1) * per_page;

        // Parse child_ids filter
        let filter_child_ids: Vec<Uuid> = query
            .child_ids
            .as_deref()
            .unwrap_or("")
            .split(',')
            .filter_map(|s| s.trim().parse::<Uuid>().ok())
            .collect();
        let has_child_filter = !filter_child_ids.is_empty();

        // Parse period range
        let period_range = query
            .period
            .as_deref()
            .and_then(|p| Self::period_range(p, query.date.as_deref()));

        if is_staff {
            // Staff see everything; optional filters apply
            let mut conditions = vec!["TRUE".to_string()];

            if let Some(gid) = query.group_id {
                conditions.push(format!("m.group_id = '{}'", gid));
            }
            if has_child_filter {
                conditions.push(format!(
                    "EXISTS (SELECT 1 FROM \"{schema}\".media_children mc WHERE mc.media_id = m.id AND mc.child_id = ANY($1::uuid[]))"
                ));
            }
            if let Some((from, to)) = &period_range {
                conditions.push(format!(
                    "m.created_at >= '{}' AND m.created_at < '{}'",
                    from, to
                ));
            }

            let where_clause = conditions.join(" AND ");

            if has_child_filter {
                sqlx::query_as::<_, Media>(&format!(
                    "SELECT {cols} FROM \"{schema}\".media m
                     WHERE {where_clause}
                     ORDER BY m.created_at DESC
                     LIMIT $2 OFFSET $3"
                ))
                .bind(&filter_child_ids)
                .bind(per_page)
                .bind(offset)
                .fetch_all(pool)
                .await
                .map_err(Into::into)
            } else {
                sqlx::query_as::<_, Media>(&format!(
                    "SELECT {cols} FROM \"{schema}\".media m
                     WHERE {where_clause}
                     ORDER BY m.created_at DESC
                     LIMIT $1 OFFSET $2"
                ))
                .bind(per_page)
                .bind(offset)
                .fetch_all(pool)
                .await
                .map_err(Into::into)
            }
        } else {
            // Parents: only non-private media, filtered by their children/groups
            let mut conditions = vec![
                "m.visibility != 'private'".to_string(),
                format!(
                    "(
                      -- Public
                      m.visibility = 'public'
                      OR
                      -- Group: parent has a child in this group
                      (m.visibility = 'group' AND m.group_id IN (
                          SELECT DISTINCT c.group_id
                          FROM \"{schema}\".child_parents cp
                          JOIN \"{schema}\".children c ON c.id = cp.child_id
                          WHERE cp.user_id = '{user_id}' AND c.group_id IS NOT NULL
                      ))
                      OR
                      -- Child-specific: parent linked to at least one of the assigned children
                      (m.visibility = 'child' AND EXISTS (
                          SELECT 1 FROM \"{schema}\".media_children mc
                          JOIN \"{schema}\".child_parents cp ON cp.child_id = mc.child_id
                          WHERE mc.media_id = m.id AND cp.user_id = '{user_id}'
                      ))
                    )"
                ),
            ];

            if let Some(gid) = query.group_id {
                conditions.push(format!("m.group_id = '{}'", gid));
            }
            if has_child_filter {
                conditions.push(format!(
                    "EXISTS (SELECT 1 FROM \"{schema}\".media_children mc WHERE mc.media_id = m.id AND mc.child_id = ANY($1::uuid[]))"
                ));
            }
            if let Some((from, to)) = &period_range {
                conditions.push(format!(
                    "m.created_at >= '{}' AND m.created_at < '{}'",
                    from, to
                ));
            }

            let where_clause = conditions.join(" AND ");

            if has_child_filter {
                sqlx::query_as::<_, Media>(&format!(
                    "SELECT {cols} FROM \"{schema}\".media m
                     WHERE {where_clause}
                     ORDER BY m.created_at DESC
                     LIMIT $2 OFFSET $3"
                ))
                .bind(&filter_child_ids)
                .bind(per_page)
                .bind(offset)
                .fetch_all(pool)
                .await
                .map_err(Into::into)
            } else {
                sqlx::query_as::<_, Media>(&format!(
                    "SELECT {cols} FROM \"{schema}\".media m
                     WHERE {where_clause}
                     ORDER BY m.created_at DESC
                     LIMIT $1 OFFSET $2"
                ))
                .bind(per_page)
                .bind(offset)
                .fetch_all(pool)
                .await
                .map_err(Into::into)
            }
        }
    }

    pub async fn update(
        pool: &PgPool,
        tenant: &str,
        media_id: Uuid,
        user_id: Uuid,
        is_staff: bool,
        req: &UpdateMediaRequest,
    ) -> anyhow::Result<Option<Media>> {
        let schema = schema_name(tenant);
        let cols = media_cols(&schema);

        let db_group_id = if req.visibility == "group" { req.group_id } else { None };

        let media = if is_staff {
            sqlx::query_as::<_, Media>(&format!(
                "UPDATE \"{schema}\".media m
                 SET caption = $2, group_id = $3, visibility = $4::\"{schema}\".media_visibility
                 WHERE id = $1
                 RETURNING {cols}"
            ))
            .bind(media_id)
            .bind(&req.caption)
            .bind(db_group_id)
            .bind(&req.visibility)
            .fetch_optional(pool)
            .await?
        } else {
            sqlx::query_as::<_, Media>(&format!(
                "UPDATE \"{schema}\".media m
                 SET caption = $2, group_id = $3, visibility = $4::\"{schema}\".media_visibility
                 WHERE id = $1 AND uploader_id = $5
                 RETURNING {cols}"
            ))
            .bind(media_id)
            .bind(&req.caption)
            .bind(db_group_id)
            .bind(&req.visibility)
            .bind(user_id)
            .fetch_optional(pool)
            .await?
        };

        if media.is_some() {
            // Sync media_children
            sqlx::query(&format!(
                "DELETE FROM \"{schema}\".media_children WHERE media_id = $1"
            ))
            .bind(media_id)
            .execute(pool)
            .await?;

            if let Some(child_ids) = &req.child_ids {
                for child_id in child_ids {
                    sqlx::query(&format!(
                        "INSERT INTO \"{schema}\".media_children (media_id, child_id) VALUES ($1, $2)
                         ON CONFLICT DO NOTHING"
                    ))
                    .bind(media_id)
                    .bind(child_id)
                    .execute(pool)
                    .await?;
                }
            }

            // Re-fetch with updated child_ids
            let updated = sqlx::query_as::<_, Media>(&format!(
                "SELECT {cols} FROM \"{schema}\".media m WHERE m.id = $1"
            ))
            .bind(media_id)
            .fetch_optional(pool)
            .await?;
            return Ok(updated);
        }

        Ok(None)
    }

    pub async fn delete(
        pool: &PgPool,
        tenant: &str,
        media_id: Uuid,
        user_id: Uuid,
        is_staff: bool,
        media_dir: &str,
    ) -> anyhow::Result<bool> {
        let schema = schema_name(tenant);

        // Fetch paths before deleting
        let row: Option<(String, Option<String>)> = if is_staff {
            sqlx::query_as(&format!(
                "SELECT storage_path, thumbnail_path FROM \"{schema}\".media WHERE id = $1"
            ))
            .bind(media_id)
            .fetch_optional(pool)
            .await?
        } else {
            sqlx::query_as(&format!(
                "SELECT storage_path, thumbnail_path FROM \"{schema}\".media
                 WHERE id = $1 AND uploader_id = $2"
            ))
            .bind(media_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?
        };

        let Some((storage_path, thumbnail_path)) = row else {
            return Ok(false);
        };

        // Delete DB record (media_children cascade)
        if is_staff {
            sqlx::query(&format!("DELETE FROM \"{schema}\".media WHERE id = $1"))
                .bind(media_id)
                .execute(pool)
                .await?;
        } else {
            sqlx::query(&format!(
                "DELETE FROM \"{schema}\".media WHERE id = $1 AND uploader_id = $2"
            ))
            .bind(media_id)
            .bind(user_id)
            .execute(pool)
            .await?;
        }

        // Delete physical files
        let base = PathBuf::from(media_dir);
        let _ = tokio::fs::remove_file(base.join(&storage_path)).await;
        if let Some(thumb) = thumbnail_path {
            let _ = tokio::fs::remove_file(base.join(&thumb)).await;
        }

        Ok(true)
    }

    pub async fn bulk(
        pool: &PgPool,
        tenant: &str,
        req: &BulkMediaRequest,
        media_dir: &str,
    ) -> anyhow::Result<usize> {
        let schema = schema_name(tenant);

        match req.action.as_str() {
            "delete" => {
                // Fetch paths for all media ids
                let rows: Vec<(Uuid, String, Option<String>)> = sqlx::query_as(&format!(
                    "SELECT id, storage_path, thumbnail_path FROM \"{schema}\".media
                     WHERE id = ANY($1)"
                ))
                .bind(&req.media_ids)
                .fetch_all(pool)
                .await?;

                let count = rows.len();

                // Delete DB records
                sqlx::query(&format!(
                    "DELETE FROM \"{schema}\".media WHERE id = ANY($1)"
                ))
                .bind(&req.media_ids)
                .execute(pool)
                .await?;

                // Delete physical files
                let base = PathBuf::from(media_dir);
                for (_, storage_path, thumbnail_path) in rows {
                    let _ = tokio::fs::remove_file(base.join(&storage_path)).await;
                    if let Some(thumb) = thumbnail_path {
                        let _ = tokio::fs::remove_file(base.join(&thumb)).await;
                    }
                }

                Ok(count)
            }
            "assign" => {
                let visibility = req.visibility.as_deref().unwrap_or("private");
                let db_group_id = if visibility == "group" { req.group_id } else { None };

                sqlx::query(&format!(
                    "UPDATE \"{schema}\".media
                     SET visibility = $1::\"{schema}\".media_visibility, group_id = $2
                     WHERE id = ANY($3)"
                ))
                .bind(visibility)
                .bind(db_group_id)
                .bind(&req.media_ids)
                .execute(pool)
                .await?;

                // Sync media_children for all updated media
                sqlx::query(&format!(
                    "DELETE FROM \"{schema}\".media_children WHERE media_id = ANY($1)"
                ))
                .bind(&req.media_ids)
                .execute(pool)
                .await?;

                if let Some(child_ids) = &req.child_ids {
                    for media_id in &req.media_ids {
                        for child_id in child_ids {
                            sqlx::query(&format!(
                                "INSERT INTO \"{schema}\".media_children (media_id, child_id)
                                 VALUES ($1, $2) ON CONFLICT DO NOTHING"
                            ))
                            .bind(media_id)
                            .bind(child_id)
                            .execute(pool)
                            .await?;
                        }
                    }
                }

                Ok(req.media_ids.len())
            }
            _ => Err(anyhow::anyhow!("Unknown bulk action: {}", req.action)),
        }
    }
}
