use std::path::{Path, PathBuf};

use axum::extract::Multipart;
use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
    models::document::{Document, DocumentQuery, UpdateDocumentRequest},
};

/// Explicit column list for Document — casts category enum to TEXT.
const DOC_COLS: &str =
    "id, uploader_id, title, category::TEXT as category, original_filename,
     storage_path, content_type, size_bytes, group_id, child_id, created_at, updated_at";

pub struct DocumentService;

impl DocumentService {
    pub async fn upload(
        pool: &PgPool,
        tenant: &str,
        uploader_id: Uuid,
        media_dir: &str,
        mut multipart: Multipart,
    ) -> anyhow::Result<Document> {
        let doc_dir = PathBuf::from(media_dir).join(tenant).join("documents");
        tokio::fs::create_dir_all(&doc_dir).await?;

        let mut file_data: Option<(Vec<u8>, String, String)> = None;
        let mut title: Option<String> = None;
        let mut category = "autre".to_string();
        let mut group_id: Option<Uuid> = None;
        let mut child_id: Option<Uuid> = None;

        while let Some(field) = multipart.next_field().await? {
            let name = field.name().unwrap_or("").to_string();
            match name.as_str() {
                "file" => {
                    let filename = field.file_name().unwrap_or("document").to_string();
                    let ct = field
                        .content_type()
                        .unwrap_or("application/octet-stream")
                        .to_string();
                    let bytes = field.bytes().await?.to_vec();
                    file_data = Some((bytes, filename, ct));
                }
                "title" => {
                    title = Some(field.text().await?);
                }
                "category" => {
                    let cat_str = field.text().await?;
                    // Validate against known values; default to "autre"
                    category = match cat_str.as_str() {
                        "formulaire" | "menu" | "politique" | "bulletin" | "autre" => cat_str,
                        _ => "autre".to_string(),
                    };
                }
                "group_id" => {
                    group_id = field.text().await?.parse().ok();
                }
                "child_id" => {
                    child_id = field.text().await?.parse().ok();
                }
                _ => {}
            }
        }

        let (bytes, original_filename, content_type) =
            file_data.ok_or_else(|| anyhow::anyhow!("No file field in upload"))?;

        let ext = Path::new(&original_filename)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin");

        let file_id = Uuid::new_v4();
        let storage_filename = format!("{}.{}", file_id, ext);
        let storage_path_full = doc_dir.join(&storage_filename);
        let storage_path_rel = format!("{}/documents/{}", tenant, storage_filename);

        tokio::fs::write(&storage_path_full, &bytes).await?;

        let schema = schema_name(tenant);
        let doc = sqlx::query_as::<_, Document>(&format!(
            "INSERT INTO {schema}.documents
             (uploader_id, title, category, original_filename, storage_path, content_type, size_bytes, group_id, child_id)
             VALUES ($1, $2, $3::\"{schema}\".doc_category, $4, $5, $6, $7, $8, $9)
             RETURNING {DOC_COLS}"
        ))
        .bind(uploader_id)
        .bind(title.unwrap_or_else(|| original_filename.clone()))
        .bind(&category)
        .bind(&original_filename)
        .bind(&storage_path_rel)
        .bind(&content_type)
        .bind(bytes.len() as i64)
        .bind(group_id)
        .bind(child_id)
        .fetch_one(pool)
        .await?;

        Ok(doc)
    }

    pub async fn list(
        pool: &PgPool,
        tenant: &str,
        user_id: Uuid,
        is_staff: bool,
        query: &DocumentQuery,
    ) -> anyhow::Result<Vec<Document>> {
        let schema = schema_name(tenant);
        let per_page = query.per_page.unwrap_or(20).clamp(1, 100);
        let offset = (query.page.unwrap_or(1).max(1) - 1) * per_page;

        let docs = if is_staff {
            sqlx::query_as::<_, Document>(&format!(
                "SELECT {DOC_COLS} FROM {schema}.documents d
                 WHERE ($1::text IS NULL OR d.category::text = $1)
                   AND ($2::uuid IS NULL OR d.group_id = $2)
                   AND ($3::uuid IS NULL OR d.child_id = $3)
                 ORDER BY d.created_at DESC
                 LIMIT $4 OFFSET $5"
            ))
            .bind(&query.category)
            .bind(query.group_id)
            .bind(query.child_id)
            .bind(per_page)
            .bind(offset)
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query_as::<_, Document>(&format!(
                "SELECT {DOC_COLS} FROM {schema}.documents d
                 WHERE (
                   (d.child_id IS NULL AND d.group_id IS NULL)
                   OR (d.child_id IS NULL AND d.group_id IS NOT NULL AND d.group_id IN (
                       SELECT DISTINCT c.group_id
                       FROM {schema}.child_parents cp
                       JOIN {schema}.children c ON c.id = cp.child_id
                       WHERE cp.user_id = $1 AND c.group_id IS NOT NULL
                   ))
                   OR (d.child_id IS NOT NULL AND d.child_id IN (
                       SELECT cp.child_id FROM {schema}.child_parents cp WHERE cp.user_id = $1
                   ))
                 )
                 AND ($2::text IS NULL OR d.category::text = $2)
                 AND ($3::uuid IS NULL OR d.group_id = $3)
                 AND ($4::uuid IS NULL OR d.child_id = $4)
                 ORDER BY d.created_at DESC
                 LIMIT $5 OFFSET $6"
            ))
            .bind(user_id)
            .bind(&query.category)
            .bind(query.group_id)
            .bind(query.child_id)
            .bind(per_page)
            .bind(offset)
            .fetch_all(pool)
            .await?
        };

        Ok(docs)
    }

    pub async fn update(
        pool: &PgPool,
        tenant: &str,
        doc_id: Uuid,
        user_id: Uuid,
        is_staff: bool,
        req: &UpdateDocumentRequest,
    ) -> anyhow::Result<Option<Document>> {
        let schema = schema_name(tenant);

        let category = match req.category.as_str() {
            "formulaire" | "menu" | "politique" | "bulletin" | "autre" => req.category.as_str(),
            _ => "autre",
        };

        let (new_group_id, new_child_id) = match req.visibility.as_str() {
            "group" => (req.group_id, None),
            "child" => (None, req.child_id),
            _ => (None, None),
        };

        let doc = if is_staff {
            sqlx::query_as::<_, Document>(&format!(
                "UPDATE {schema}.documents
                 SET title = $2, category = $3::\"{schema}\".doc_category,
                     group_id = $4, child_id = $5
                 WHERE id = $1
                 RETURNING {DOC_COLS}"
            ))
            .bind(doc_id)
            .bind(&req.title)
            .bind(category)
            .bind(new_group_id)
            .bind(new_child_id)
            .fetch_optional(pool)
            .await?
        } else {
            sqlx::query_as::<_, Document>(&format!(
                "UPDATE {schema}.documents
                 SET title = $2, category = $3::\"{schema}\".doc_category,
                     group_id = $4, child_id = $5
                 WHERE id = $1 AND uploader_id = $6
                 RETURNING {DOC_COLS}"
            ))
            .bind(doc_id)
            .bind(&req.title)
            .bind(category)
            .bind(new_group_id)
            .bind(new_child_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?
        };

        Ok(doc)
    }

    pub async fn delete(
        pool: &PgPool,
        tenant: &str,
        doc_id: Uuid,
        user_id: Uuid,
        is_staff: bool,
        media_dir: &str,
    ) -> anyhow::Result<bool> {
        let schema = schema_name(tenant);

        let row: Option<(String,)> = if is_staff {
            sqlx::query_as(&format!(
                "SELECT storage_path FROM {schema}.documents WHERE id = $1"
            ))
            .bind(doc_id)
            .fetch_optional(pool)
            .await?
        } else {
            sqlx::query_as(&format!(
                "SELECT storage_path FROM {schema}.documents
                 WHERE id = $1 AND uploader_id = $2"
            ))
            .bind(doc_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?
        };

        let Some((storage_path,)) = row else {
            return Ok(false);
        };

        if is_staff {
            sqlx::query(&format!("DELETE FROM {schema}.documents WHERE id = $1"))
                .bind(doc_id)
                .execute(pool)
                .await?;
        } else {
            sqlx::query(&format!(
                "DELETE FROM {schema}.documents WHERE id = $1 AND uploader_id = $2"
            ))
            .bind(doc_id)
            .bind(user_id)
            .execute(pool)
            .await?;
        }

        let _ = tokio::fs::remove_file(
            PathBuf::from(media_dir).join(&storage_path)
        ).await;

        Ok(true)
    }
}
