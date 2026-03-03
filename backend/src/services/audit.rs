use sqlx::PgPool;
use uuid::Uuid;

use crate::db::tenant::schema_name;

/// An audit log entry to record.
pub struct AuditEntry {
    pub user_id:        Option<Uuid>,
    pub user_name:      Option<String>,
    pub action:         String,
    pub resource_type:  Option<String>,
    pub resource_id:    Option<String>,
    pub resource_label: Option<String>,
    pub ip_address:     String,
}

/// Fire-and-forget audit log entry.
/// Spawns a background task — never blocks the request handler,
/// never propagates errors (logs a warning on failure).
pub fn log(pool: PgPool, tenant: &str, entry: AuditEntry) {
    let schema = schema_name(tenant);

    tokio::spawn(async move {
        let res = sqlx::query(&format!(
            "INSERT INTO {schema}.audit_log
                (user_id, user_name, action, resource_type, resource_id, resource_label, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7)"
        ))
        .bind(entry.user_id)
        .bind(entry.user_name)
        .bind(entry.action)
        .bind(entry.resource_type)
        .bind(entry.resource_id)
        .bind(entry.resource_label)
        .bind(entry.ip_address)
        .execute(&pool)
        .await;

        if let Err(e) = res {
            tracing::warn!("audit log insert failed for schema {schema}: {e}");
        }
    });
}
