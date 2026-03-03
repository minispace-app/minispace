use axum::{extract::{Path, Query, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
    middleware::{super_admin::SuperAdminAuth, tenant::TenantSlug},
    models::{auth::AuthenticatedUser, user::UserRole},
    AppState,
};

#[derive(Deserialize)]
pub struct GlobalAuditQuery {
    pub page:   Option<i64>,
    pub limit:  Option<i64>,
    pub action: Option<String>,
    pub tenant: Option<String>,
}

#[derive(Deserialize)]
pub struct AuditQuery {
    pub page:   Option<i64>,
    pub limit:  Option<i64>,
    pub action: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AuditLogRow {
    pub id:             Uuid,
    pub user_id:        Option<Uuid>,
    pub user_name:      Option<String>,
    pub action:         String,
    pub resource_type:  Option<String>,
    pub resource_id:    Option<String>,
    pub resource_label: Option<String>,
    pub ip_address:     Option<String>,
    pub created_at:     DateTime<Utc>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct GlobalAuditLogRow {
    pub tenant:         String,
    pub id:             Uuid,
    pub user_name:      Option<String>,
    pub action:         String,
    pub resource_label: Option<String>,
    pub ip_address:     Option<String>,
    pub created_at:     DateTime<Utc>,
}

pub async fn list_audit_log(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Query(params): Query<AuditQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Admin only
    match user.role {
        UserRole::AdminGarderie | UserRole::SuperAdmin => {}
        _ => return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Accès refusé" })))),
    }

    let schema = schema_name(&tenant);
    let limit  = params.limit.unwrap_or(50).min(200);
    let page   = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * limit;

    let (entries, total) = if let Some(action_filter) = &params.action {
        let rows: Vec<AuditLogRow> = sqlx::query_as(&format!(
            "SELECT id, user_id, user_name, action, resource_type, resource_id, resource_label, ip_address, created_at
             FROM {schema}.audit_log
             WHERE action LIKE $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3"
        ))
        .bind(format!("{action_filter}%"))
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

        let total: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM {schema}.audit_log WHERE action LIKE $1"
        ))
        .bind(format!("{action_filter}%"))
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        (rows, total)
    } else {
        let rows: Vec<AuditLogRow> = sqlx::query_as(&format!(
            "SELECT id, user_id, user_name, action, resource_type, resource_id, resource_label, ip_address, created_at
             FROM {schema}.audit_log
             ORDER BY created_at DESC
             LIMIT $1 OFFSET $2"
        ))
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

        let total: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM {schema}.audit_log"
        ))
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        (rows, total)
    };

    Ok(Json(json!({
        "entries": entries,
        "total":   total,
        "page":    page,
        "limit":   limit,
    })))
}

/// Super-admin: query the audit log of any tenant by slug.
/// Auth: X-Super-Admin-Key header (SuperAdminAuth extractor).
pub async fn super_admin_audit_log(
    State(state): State<AppState>,
    _auth: SuperAdminAuth,
    Path(slug): Path<String>,
    Query(params): Query<AuditQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let schema = schema_name(&slug);
    let limit  = params.limit.unwrap_or(100).min(500);
    let page   = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * limit;

    let (entries, total) = if let Some(action_filter) = &params.action {
        let rows: Vec<AuditLogRow> = sqlx::query_as(&format!(
            "SELECT id, user_id, user_name, action, resource_type, resource_id, resource_label, ip_address, created_at
             FROM {schema}.audit_log
             WHERE action LIKE $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3"
        ))
        .bind(format!("{action_filter}%"))
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

        let total: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM {schema}.audit_log WHERE action LIKE $1"
        ))
        .bind(format!("{action_filter}%"))
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        (rows, total)
    } else {
        let rows: Vec<AuditLogRow> = sqlx::query_as(&format!(
            "SELECT id, user_id, user_name, action, resource_type, resource_id, resource_label, ip_address, created_at
             FROM {schema}.audit_log
             ORDER BY created_at DESC
             LIMIT $1 OFFSET $2"
        ))
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

        let total: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM {schema}.audit_log"
        ))
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        (rows, total)
    };

    Ok(Json(json!({
        "entries": entries,
        "total":   total,
        "page":    page,
        "limit":   limit,
        "tenant":  slug,
    })))
}

/// Super-admin: query the global audit log across all active tenants.
/// Auth: X-Super-Admin-Key header (SuperAdminAuth extractor).
pub async fn super_admin_global_audit_log(
    State(state): State<AppState>,
    _auth: SuperAdminAuth,
    Query(params): Query<GlobalAuditQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let limit  = params.limit.unwrap_or(50).min(200);
    let page   = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * limit;

    // Fetch all active garderie slugs
    let slugs: Vec<(String,)> = sqlx::query_as(
        "SELECT slug FROM public.garderies WHERE is_active = TRUE ORDER BY slug"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    if slugs.is_empty() {
        return Ok(Json(json!({
            "entries": Vec::<GlobalAuditLogRow>::new(),
            "total":   0,
            "page":    page,
            "limit":   limit,
        })));
    }

    // Filter to single tenant if specified
    let filtered_slugs: Vec<String> = if let Some(tenant_filter) = &params.tenant {
        if slugs.iter().any(|(s,)| s == tenant_filter) {
            vec![tenant_filter.clone()]
        } else {
            return Ok(Json(json!({
                "entries": Vec::<GlobalAuditLogRow>::new(),
                "total":   0,
                "page":    page,
                "limit":   limit,
            })));
        }
    } else {
        slugs.iter().map(|(s,)| s.clone()).collect()
    };

    // Build UNION ALL query dynamically
    let mut union_queries = Vec::new();
    for slug in &filtered_slugs {
        let schema = schema_name(slug);
        let query = if let Some(action_filter) = &params.action {
            format!(
                "SELECT '{}' as tenant, id, user_name, action, resource_label, ip_address, created_at FROM {}.audit_log WHERE action LIKE '{}%'",
                slug.replace("'", "''"), schema, action_filter.replace("'", "''")
            )
        } else {
            format!(
                "SELECT '{}' as tenant, id, user_name, action, resource_label, ip_address, created_at FROM {}.audit_log",
                slug.replace("'", "''"), schema
            )
        };
        union_queries.push(query);
    }

    if union_queries.is_empty() {
        return Ok(Json(json!({
            "entries": Vec::<GlobalAuditLogRow>::new(),
            "total":   0,
            "page":    page,
            "limit":   limit,
        })));
    }

    let union_sql = union_queries.join(" UNION ALL ");

    // Get total count
    let total_sql = format!("SELECT COUNT(*) as count FROM ({}) as combined", union_sql);
    let total: i64 = sqlx::query_scalar(&total_sql)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    // Get paginated entries
    let entries_sql = format!(
        "{} ORDER BY created_at DESC LIMIT {} OFFSET {}",
        union_sql, limit, offset
    );
    let entries: Vec<GlobalAuditLogRow> = sqlx::query_as(&entries_sql)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    Ok(Json(json!({
        "entries": entries,
        "total":   total,
        "page":    page,
        "limit":   limit,
    })))
}
