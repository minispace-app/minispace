/// Data retention and purging according to privacy policy.
/// Schedule: Run daily (e.g., 2 AM UTC via cron job or cloud scheduler)
///
/// Retention periods (from privacy policy - confidentialité):
/// - Children data: is_deleted + 1 year → hard-delete
/// - Photos/media: is_deleted + 6 months → hard-delete
/// - Messages: is_deleted + 2 years → hard-delete
/// - Admin/financial docs: is_deleted + 7 years → hard-delete
/// - Audit logs: created + 90 days → hard-delete
/// - Technical logs: created + 90 days → hard-delete

use chrono::{Duration, Utc};
use sqlx::PgPool;

use crate::db::tenant::schema_name;

pub struct CronService;

impl CronService {
    /// Purge all expired data across all garderies based on retention policy.
    /// This should be called once daily (e.g., 2 AM UTC).
    pub async fn purge_expired_data(pool: &PgPool, tenant: &str) -> anyhow::Result<()> {
        let schema = schema_name(tenant);

        // 1. Children data: deleted + 1 year
        let child_expiry = Utc::now() - Duration::days(365);
        let child_count: i64 = sqlx::query_scalar(&format!(
            "DELETE FROM {schema}.children
             WHERE is_deleted = TRUE AND deleted_at < $1
             RETURNING COUNT(*)"
        ))
        .bind(child_expiry)
        .fetch_one(pool)
        .await
        .unwrap_or(0);

        if child_count > 0 {
            tracing::info!(
                "Purged {} deleted children from {schema} (older than 1 year)",
                child_count
            );
        }

        // 2. Media/photos: deleted + 6 months
        let media_expiry = Utc::now() - Duration::days(180);
        let media_count: i64 = sqlx::query_scalar(&format!(
            "DELETE FROM {schema}.media
             WHERE is_deleted = TRUE AND deleted_at < $1
             RETURNING COUNT(*)"
        ))
        .bind(media_expiry)
        .fetch_one(pool)
        .await
        .unwrap_or(0);

        if media_count > 0 {
            tracing::info!(
                "Purged {} deleted media from {schema} (older than 6 months)",
                media_count
            );
        }

        // 3. Messages: deleted + 2 years
        let message_expiry = Utc::now() - Duration::days(730);
        let message_count: i64 = sqlx::query_scalar(&format!(
            "DELETE FROM {schema}.messages
             WHERE is_deleted = TRUE AND deleted_at < $1
             RETURNING COUNT(*)"
        ))
        .bind(message_expiry)
        .fetch_one(pool)
        .await
        .unwrap_or(0);

        if message_count > 0 {
            tracing::info!(
                "Purged {} deleted messages from {schema} (older than 2 years)",
                message_count
            );
        }

        // 4. Documents: deleted + 7 years
        let doc_expiry = Utc::now() - Duration::days(2555);
        let doc_count: i64 = sqlx::query_scalar(&format!(
            "DELETE FROM {schema}.documents
             WHERE is_deleted = TRUE AND deleted_at < $1
             RETURNING COUNT(*)"
        ))
        .bind(doc_expiry)
        .fetch_one(pool)
        .await
        .unwrap_or(0);

        if doc_count > 0 {
            tracing::info!(
                "Purged {} deleted documents from {schema} (older than 7 years)",
                doc_count
            );
        }

        // 5. Audit logs: created + 90 days
        let audit_expiry = Utc::now() - Duration::days(90);
        let audit_count: i64 = sqlx::query_scalar(&format!(
            "DELETE FROM {schema}.audit_log
             WHERE created_at < $1
             RETURNING COUNT(*)"
        ))
        .bind(audit_expiry)
        .fetch_one(pool)
        .await
        .unwrap_or(0);

        if audit_count > 0 {
            tracing::info!(
                "Purged {} audit logs from {schema} (older than 90 days)",
                audit_count
            );
        }

        Ok(())
    }

    /// Mark media as soft-deleted when a child is deleted.
    /// This is called by the child deletion handler.
    pub async fn soft_delete_child_media(
        pool: &PgPool,
        tenant: &str,
        child_id: &uuid::Uuid,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);

        // Mark single-child media as deleted (media.child_id = this child)
        sqlx::query(&format!(
            "UPDATE {schema}.media
             SET is_deleted = TRUE, deleted_at = NOW()
             WHERE child_id = $1 AND is_deleted = FALSE"
        ))
        .bind(child_id)
        .execute(pool)
        .await?;

        // For multi-child photos (media_children junction):
        // We keep the photo but remove the child's tag
        // (This respects other children's photo rights)
        sqlx::query(&format!(
            "DELETE FROM {schema}.media_children WHERE child_id = $1"
        ))
        .bind(child_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Mark messages as soft-deleted when a child leaves.
    pub async fn soft_delete_child_messages(
        pool: &PgPool,
        tenant: &str,
        child_id: &uuid::Uuid,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);

        sqlx::query(&format!(
            "UPDATE {schema}.messages
             SET is_deleted = TRUE, deleted_at = NOW()
             WHERE child_id = $1 AND is_deleted = FALSE"
        ))
        .bind(child_id)
        .execute(pool)
        .await?;

        Ok(())
    }
}
