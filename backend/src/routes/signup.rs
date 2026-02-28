use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    db::tenant::{provision_tenant_schema, schema_name},
    middleware::rate_limit::check_rate_limit,
    models::tenant::SignupRequest,
    AppState,
};

const RESERVED_SLUGS: &[&str] = &[
    "www", "api", "demo", "super-admin", "app", "admin", "login", "signup",
    "register", "support", "billing", "status", "about", "contact", "docs",
];

fn is_valid_signup_slug(s: &str) -> bool {
    let len = s.len();
    len >= 3
        && len <= 32
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !s.starts_with('-')
        && !s.ends_with('-')
}

/// Extracts the real client IP from nginx-forwarded headers.
/// Priority: X-Real-IP (set by nginx from CF-Connecting-IP) → first X-Forwarded-For.
fn real_ip(headers: &HeaderMap) -> String {
    if let Some(ip) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        return ip.to_string();
    }
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = xff.split(',').next() {
            return first.trim().to_string();
        }
    }
    "unknown".to_string()
}

#[derive(Deserialize)]
pub struct CheckSlugQuery {
    pub slug: String,
}

pub async fn check_slug(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<CheckSlugQuery>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    // Rate limit: 30/min per IP (nginx already limits to 20/min, this is a backstop)
    {
        let ip = real_ip(&headers);
        let key = format!("rate:check-slug:ip:{ip}");
        let mut redis = state.redis.clone();
        check_rate_limit(&mut redis, &key, 30, 60).await?;
    }

    let slug = params.slug.to_lowercase();

    if !is_valid_signup_slug(&slug) {
        return Ok((
            StatusCode::OK,
            Json(json!({
                "available": false,
                "reason": "L'identifiant doit contenir entre 3 et 32 caractères (lettres, chiffres, tirets)."
            })),
        ));
    }

    if RESERVED_SLUGS.contains(&slug.as_str()) {
        return Ok((
            StatusCode::OK,
            Json(json!({ "available": false, "reason": "Cet identifiant est réservé." })),
        ));
    }

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.garderies WHERE slug = $1)")
        .bind(&slug)
        .fetch_one(&state.db)
        .await
        .unwrap_or(true);

    if exists {
        Ok((StatusCode::OK, Json(json!({ "available": false, "reason": "Cet identifiant est déjà pris." }))))
    } else {
        Ok((StatusCode::OK, Json(json!({ "available": true }))))
    }
}

pub async fn signup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SignupRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let ip = real_ip(&headers);
    let mut redis = state.redis.clone();

    // Rate limit 1: 5 signups/hour per IP (prevents one source from abusing)
    check_rate_limit(&mut redis, &format!("rate:signup:ip:{ip}"), 5, 3600).await?;

    // Rate limit 2: 20 signups/hour globally (total cap across all IPs)
    check_rate_limit(&mut redis, "rate:signup:global", 20, 3600).await?;

    // Validate inputs
    let slug = body.slug.to_lowercase();

    if !is_valid_signup_slug(&slug) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "L'identifiant doit contenir entre 3 et 32 caractères (lettres minuscules, chiffres, tirets), sans commencer ni finir par un tiret." })),
        ));
    }

    if RESERVED_SLUGS.contains(&slug.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Cet identifiant est réservé." })),
        ));
    }

    if !body.email.contains('@') {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Adresse courriel invalide." }))));
    }

    if body.password.len() < 8 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Le mot de passe doit contenir au moins 8 caractères." })),
        ));
    }

    if body.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Le nom de la garderie est requis." }))));
    }

    if body.first_name.trim().is_empty() || body.last_name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Le prénom et le nom sont requis." }))));
    }

    // 1. Insert garderie with 30-day trial
    let trial_expires_at = Utc::now() + chrono::Duration::days(30);

    let garderie_result = sqlx::query_as::<_, (uuid::Uuid, String, chrono::DateTime<Utc>)>(
        "INSERT INTO public.garderies (slug, name, phone, address, email, plan, trial_expires_at)
         VALUES ($1, $2, $3, $4, $5, 'free', $6)
         RETURNING id, slug, trial_expires_at",
    )
    .bind(&slug)
    .bind(body.name.trim())
    .bind(body.phone.as_deref().filter(|s| !s.trim().is_empty()))
    .bind(body.address.as_deref().filter(|s| !s.trim().is_empty()))
    .bind(&body.email)
    .bind(trial_expires_at)
    .fetch_one(&state.db)
    .await;

    let (_id, created_slug, expires_at) = match garderie_result {
        Ok(row) => row,
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("unique") || msg.contains("duplicate") || msg.contains("already exists") {
                return Err((
                    StatusCode::CONFLICT,
                    Json(json!({ "error": "Cet identifiant est déjà pris. Choisissez-en un autre." })),
                ));
            }
            return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": msg }))));
        }
    };

    // 2. Provision tenant schema
    provision_tenant_schema(&state.db, &created_slug)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Schema provisioning failed: {e}") })),
            )
        })?;

    // 3. Create admin user
    let schema = schema_name(&created_slug);
    let password_hash = bcrypt::hash(&body.password, 12)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    sqlx::query(&format!(
        r#"INSERT INTO "{schema}".users (email, password_hash, first_name, last_name, role)
           VALUES ($1, $2, $3, $4, 'admin_garderie'::"{schema}".user_role)"#
    ))
    .bind(&body.email)
    .bind(&password_hash)
    .bind(body.first_name.trim())
    .bind(body.last_name.trim())
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;

    // Build login URL from base URL: https://minispace.app → https://{slug}.minispace.app/fr/login
    let login_url = {
        let base = &state.config.app_base_url;
        if let Some(idx) = base.find("://") {
            let scheme = &base[..idx + 3];
            let rest = &base[idx + 3..];
            let domain = rest.split('/').next().unwrap_or(rest);
            let domain_clean = domain.split(':').next().unwrap_or(domain);
            format!("{scheme}{created_slug}.{domain_clean}/fr/login")
        } else {
            format!("{base}/{created_slug}/fr/login")
        }
    };

    // Emails fire-and-forget — n'échouent pas le signup si SMTP down
    if let Some(email_svc) = &state.email {
        let expires_str = expires_at.format("%d %B %Y").to_string();
        let svc = email_svc.clone();
        let slug_c = created_slug.clone();
        let name_c = body.name.trim().to_string();
        let email_c = body.email.clone();
        let first_c = body.first_name.trim().to_string();
        let last_c = body.last_name.trim().to_string();
        let phone_c = body.phone.clone().unwrap_or_default();
        let address_c = body.address.clone().unwrap_or_default();
        let login_url_c = login_url.clone();
        tokio::spawn(async move {
            // 1. Notification interne à contact@minispace.app
            if let Err(e) = svc
                .send_new_signup_notification(&slug_c, &name_c, &email_c, &first_c, &last_c, &phone_c, &address_c, &expires_str)
                .await
            {
                tracing::warn!("signup admin notification failed for '{slug_c}': {e}");
            }
            // 2. Email de bienvenue à l'admin de la nouvelle garderie
            if let Err(e) = svc
                .send_welcome_email(&email_c, &format!("{first_c} {last_c}"), &name_c, &slug_c, &login_url_c, &expires_str)
                .await
            {
                tracing::warn!("signup welcome email failed for '{slug_c}': {e}");
            }
        });
    }

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "slug": created_slug,
            "name": body.name.trim(),
            "trial_expires_at": expires_at,
            "login_url": login_url,
        })),
    ))
}
