use axum::{extract::State, http::StatusCode, Json};
use chrono::Utc;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
    middleware::rate_limit::check_rate_limit,
    models::{
        auth::RefreshClaims,
        user::{LoginResponse, User, UserRole},
    },
    services::auth::AuthService,
    AppState,
};

/// Block email-sending actions on the demo tenant.
///
/// Call this at the start of any handler that sends real emails to prevent
/// demo visitors from triggering SMTP sends that could harm server reputation.
///
/// Routes to protect:
///   POST /auth/invite
///   POST /auth/forgot-password
///   POST /messages/send-to-parents
///   POST /email/send-to-parents
///   POST /journals/{child_id}/send-to-parents
///   POST /journals/send-all-to-parents
///   POST /users (prevents demo tenant pollution)
pub fn deny_if_demo(tenant: &str) -> Result<(), (StatusCode, Json<Value>)> {
    if tenant == "demo" {
        Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Cette action n'est pas disponible dans la version démo."
            })),
        ))
    } else {
        Ok(())
    }
}

#[derive(Deserialize)]
pub struct DemoLoginRequest {
    /// One of: "admin", "educateur", "parent"
    pub role: String,
    /// Optional: "fr" (default) or "en" for English demo users
    pub locale: Option<String>,
}

/// POST /demo/login — bypass 2FA for the demo tenant only.
///
/// Returns a full LoginResponse (access_token + refresh_token + user + garderie_name)
/// without requiring 2FA email verification. Only works if the demo tenant exists.
///
/// Rate-limited globally to prevent abuse.
pub async fn demo_login(
    State(state): State<AppState>,
    Json(body): Json<DemoLoginRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Rate limit: 30 attempts per 5 minutes globally
    let rate_key = "rate:demo_login:global";
    let mut redis = state.redis.clone();
    check_rate_limit(&mut redis, rate_key, 30, 300).await?;

    let schema = schema_name("demo");

    // Verify the demo tenant schema exists (may not yet if demo-reset hasn't run)
    let schema_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = $1)",
    )
    .bind(&schema)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    if !schema_exists {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "La démo est en cours de préparation. Revenez dans quelques instants."
            })),
        ));
    }

    // Determine locale (default: "fr")
    let locale = body.locale.as_deref().unwrap_or("fr");

    // Map requested role to the corresponding demo email
    let email = match (body.role.as_str(), locale) {
        // French users
        ("admin", "fr")     => "admin@demo.minispace.app",
        ("educateur", "fr") => "sophie@demo.minispace.app",
        ("parent", "fr")    => "jean@demo.minispace.app",
        // English users
        ("admin", "en")     => "admin-en@demo.minispace.app",
        ("educateur", "en") => "emma-en@demo.minispace.app",
        ("parent", "en")    => "michael-en@demo.minispace.app",
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "Rôle invalide. Utilisez : admin, educateur, ou parent."
                })),
            ))
        }
    };

    // Fetch demo user from garderie_demo schema
    let user = sqlx::query_as::<_, User>(&format!(
        "SELECT id, email, password_hash, first_name, last_name,
                role::TEXT as role, avatar_url, is_active, force_password_change,
                preferred_locale, created_at, updated_at
         FROM {schema}.users
         WHERE email = $1 AND is_active = TRUE"
    ))
    .bind(email)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?
    .ok_or_else(|| (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({
            "error": "Compte démo non disponible. La démo est peut-être en cours de réinitialisation."
        })),
    ))?;

    let role: UserRole = user.role.parse().unwrap_or(UserRole::Parent);

    // Generate access token (no 2FA required — this endpoint is demo-only)
    let access_token = AuthService::generate_access_token_with_role(
        &user,
        role,
        "demo",
        &state.config.jwt_secret,
        state.config.jwt_expiry_seconds,
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    // Generate refresh token and store its hash
    let now = Utc::now().timestamp() as usize;
    let jti = Uuid::new_v4();
    let refresh_claims = RefreshClaims {
        sub: user.id.to_string(),
        jti: jti.to_string(),
        iat: now,
        exp: now + (state.config.jwt_refresh_expiry_days * 86400) as usize,
    };
    let refresh_token = encode(
        &Header::new(Algorithm::HS256),
        &refresh_claims,
        &EncodingKey::from_secret(state.config.jwt_refresh_secret.as_bytes()),
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    let token_hash = bcrypt::hash(&refresh_token, 8)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;
    let expires_at = Utc::now() + chrono::Duration::days(state.config.jwt_refresh_expiry_days as i64);

    sqlx::query(&format!(
        "INSERT INTO {schema}.refresh_tokens (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)"
    ))
    .bind(jti)
    .bind(user.id)
    .bind(token_hash)
    .bind(expires_at)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    let garderie_name: String = sqlx::query_scalar(
        "SELECT name FROM public.garderies WHERE slug = 'demo'",
    )
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "Garderie Les Petits Explorateurs (Démo)".to_string());

    let response = LoginResponse {
        access_token,
        refresh_token,
        user: user.into(),
        garderie_name,
    };

    Ok(Json(serde_json::to_value(response).unwrap()))
}
