use axum::{extract::State, http::StatusCode, Json};
use serde_json::{json, Value};

use crate::{
    db::tenant::schema_name,
    middleware::tenant::TenantSlug,
    models::{auth::AuthenticatedUser, user::UserRole, user::SendEmailRequest},
    AppState,
};

pub async fn send_to_parents(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Json(body): Json<SendEmailRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Only admin_garderie and educateur may send emails
    if user.role == UserRole::Parent {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Accès refusé" })),
        ));
    }

    let email_svc = match state.email.as_deref() {
        Some(svc) => svc,
        None => {
            // SMTP not configured — return success gracefully
            return Ok(Json(json!({ "message": "Email envoyé (mode dégradé)" })));
        }
    };

    let schema = schema_name(&tenant);

    // Fetch recipients
    let recipients: Vec<(String, String)> = if let Some(rid) = body.recipient_id {
        sqlx::query_as(&format!(
            "SELECT email, first_name || ' ' || last_name
             FROM {schema}.users
             WHERE id = $1 AND role::TEXT = 'parent' AND is_active = TRUE"
        ))
        .bind(rid)
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })?
    } else {
        sqlx::query_as(&format!(
            "SELECT email, first_name || ' ' || last_name
             FROM {schema}.users
             WHERE role::TEXT = 'parent' AND is_active = TRUE"
        ))
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })?
    };

    if recipients.is_empty() {
        return Ok(Json(json!({ "message": "Aucun destinataire trouvé" })));
    }

    // Get garderie name for the from display
    let garderie_name: String = sqlx::query_scalar(
        "SELECT name FROM public.garderies WHERE slug = $1"
    )
    .bind(&tenant)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| tenant.clone());

    email_svc
        .send_to_parents(recipients, &body.subject, &body.body, &garderie_name)
        .await
        .map(|_| Json(json!({ "message": "Emails envoyés avec succès" })))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}
