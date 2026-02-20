use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    Json,
};
use uuid::Uuid;
use serde_json::{json, Value};

use crate::{
    middleware::{rate_limit::check_rate_limit, tenant::TenantSlug},
    models::{
        auth::AuthenticatedUser,
        user::{
            ChangePasswordRequest, ForgotPasswordRequest, InviteUserRequest, LoginRequest,
            RefreshTokenRequest, RegisterFromInviteRequest, RegisterPushTokenRequest,
            ResetPasswordRequest, UpdateEmailRequest, VerifyTwoFactorRequest,
        },
    },
    services::{auth::{AuthService, LoginOutcome}, notifications::NotificationService},
    AppState,
};

/// Extract a named cookie value from request headers.
fn get_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let prefix = format!("{name}=");
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|part| {
            let part = part.trim();
            if part.starts_with(&prefix) {
                Some(part[prefix.len()..].to_string())
            } else {
                None
            }
        })
}

/// Build a JSON response, optionally setting a `tdt` device cookie.
fn json_response_with_cookie(body: &Value, device_token: Option<&str>) -> Response {
    let body_str = serde_json::to_string(body).unwrap_or_default();
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(token) = device_token {
        builder = builder.header(
            header::SET_COOKIE,
            format!("tdt={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000"),
        );
    }
    builder.body(Body::from(body_str)).unwrap()
}

pub async fn login(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    // Rate limit: 5 attempts per 15 min per email+tenant
    let rate_key = format!("rate:login:{}:{}", tenant, body.email.to_lowercase());
    let mut redis = state.redis.clone();
    check_rate_limit(&mut redis, &rate_key, 5, 900).await?;

    let device_token = get_cookie(&headers, "tdt");

    match AuthService::login(
        &state.db,
        state.email.as_deref(),
        &tenant,
        &body.email,
        &body.password,
        device_token.as_deref(),
        &state.config.jwt_secret,
        &state.config.jwt_refresh_secret,
        state.config.jwt_expiry_seconds,
        state.config.jwt_refresh_expiry_days,
    )
    .await
    {
        Ok(LoginOutcome::TwoFactorRequired(step1)) => {
            Ok(json_response_with_cookie(&serde_json::to_value(step1).unwrap(), None))
        }
        Ok(LoginOutcome::Authenticated { response, device_token }) => {
            Ok(json_response_with_cookie(
                &serde_json::to_value(response).unwrap(),
                Some(&device_token),
            ))
        }
        Err(e) => Err((StatusCode::UNAUTHORIZED, Json(json!({ "error": e.to_string() })))),
    }
}

pub async fn verify_2fa(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    Json(body): Json<VerifyTwoFactorRequest>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    // Rate limit: 10 attempts per 15 min per email+tenant
    let rate_key = format!("rate:2fa:{}:{}", tenant, body.email.to_lowercase());
    let mut redis = state.redis.clone();
    check_rate_limit(&mut redis, &rate_key, 10, 900).await?;

    AuthService::verify_2fa(
        &state.db,
        &tenant,
        &body.email,
        &body.code,
        &state.config.jwt_secret,
        &state.config.jwt_refresh_secret,
        state.config.jwt_expiry_seconds,
        state.config.jwt_refresh_expiry_days,
    )
    .await
    .map(|(res, device_token)| {
        let cookie_ref: Option<&str> = if device_token.is_empty() { None } else { Some(&device_token) };
        json_response_with_cookie(&serde_json::to_value(res).unwrap(), cookie_ref)
    })
    .map_err(|e| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": e.to_string() })),
        )
    })
}

pub async fn refresh_token(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    Json(body): Json<RefreshTokenRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    AuthService::refresh(
        &state.db,
        &tenant,
        &body.refresh_token,
        &state.config.jwt_secret,
        &state.config.jwt_refresh_secret,
        state.config.jwt_expiry_seconds,
        state.config.jwt_refresh_expiry_days,
    )
    .await
    .map(|res| Json(serde_json::to_value(res).unwrap()))
    .map_err(|e| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": e.to_string() })),
        )
    })
}

pub async fn logout(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    headers: HeaderMap,
    Json(body): Json<RefreshTokenRequest>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let device_token = get_cookie(&headers, "tdt");

    AuthService::logout(
        &state.db,
        &tenant,
        &body.refresh_token,
        &state.config.jwt_refresh_secret,
        device_token.as_deref(),
    )
    .await
    .map(|_| {
        // Clear the trusted device cookie
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::SET_COOKIE, "tdt=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")
            .body(Body::from(r#"{"message":"Logged out"}"#))
            .unwrap()
    })
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })
}

pub async fn invite_user(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Json(body): Json<InviteUserRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    AuthService::create_invitation(
        &state.db,
        state.email.as_deref(),
        &tenant,
        &body.email,
        body.role,
        Some(user.user_id),
        &state.config.app_base_url,
    )
    .await
    .map(|_| Json(json!({ "message": format!("Invitation envoyée à {}", body.email) })))
    .map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        )
    })
}

pub async fn register_from_invite(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    Json(body): Json<RegisterFromInviteRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    AuthService::register_from_invite(
        &state.db,
        &tenant,
        &body.token,
        &body.first_name,
        &body.last_name,
        &body.password,
        body.preferred_locale.as_deref().unwrap_or("fr"),
    )
    .await
    .map(|profile| Json(serde_json::to_value(profile).unwrap()))
    .map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        )
    })
}

pub async fn me(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    use crate::{db::tenant::schema_name, models::user::User};
    let schema = schema_name(&tenant);
    sqlx::query_as::<_, User>(&format!(
        "SELECT id, email, password_hash, first_name, last_name,
            role::TEXT as role, avatar_url, is_active, force_password_change, preferred_locale,
            created_at, updated_at
         FROM {schema}.users WHERE id = $1"
    ))
    .bind(user.user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?
    .map(|u| Json(serde_json::to_value(crate::models::user::UserProfile::from(u)).unwrap()))
    .ok_or((StatusCode::NOT_FOUND, Json(json!({ "error": "User not found" }))))
}

/// Always returns 200 to avoid leaking account existence.
pub async fn forgot_password(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    Json(body): Json<ForgotPasswordRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Rate limit: 3 attempts per 30 min per email+tenant
    let rate_key = format!("rate:forgot:{}:{}", tenant, body.email.to_lowercase());
    let mut redis = state.redis.clone();
    check_rate_limit(&mut redis, &rate_key, 3, 1800).await?;

    AuthService::request_password_reset(
        &state.db,
        state.email.as_deref(),
        &tenant,
        &body.email,
        &state.config.app_base_url,
    )
    .await
    .map(|_| Json(json!({ "message": "Si un compte existe, un email a été envoyé." })))
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })
}

pub async fn reset_password(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    Json(body): Json<ResetPasswordRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    AuthService::reset_password(&state.db, &tenant, &body.token, &body.new_password)
        .await
        .map(|_| Json(json!({ "message": "Mot de passe réinitialisé avec succès." })))
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": e.to_string() })),
            )
        })
}

pub async fn register_push_token(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Json(body): Json<RegisterPushTokenRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    NotificationService::register_push_token(
        &state.db,
        &tenant,
        user.user_id,
        &body.platform,
        &body.token,
    )
    .await
    .map(|_| Json(json!({ "message": "Push token registered" })))
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })
}

pub async fn change_password(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Json(body): Json<ChangePasswordRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    AuthService::change_password(
        &state.db,
        &tenant,
        user.user_id,
        &body.current_password,
        &body.new_password,
    )
    .await
    .map(|_| Json(json!({ "message": "Mot de passe modifié avec succès" })))
    .map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        )
    })
}

pub async fn update_email(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Json(body): Json<UpdateEmailRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    AuthService::update_email(
        &state.db,
        &tenant,
        user.user_id,
        &body.new_email,
        &body.password,
    )
    .await
    .map(|_| Json(json!({ "message": "Email modifié avec succès" })))
    .map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        )
    })
}

pub async fn list_pending_invitations(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    _user: AuthenticatedUser,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    AuthService::list_pending_invitations(&state.db, &tenant)
        .await
        .map(|invitations| Json(serde_json::to_value(invitations).unwrap()))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}

pub async fn delete_invitation(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    _user: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    match AuthService::delete_invitation(&state.db, &tenant, id).await {
        Ok(true) => Ok(Json(json!({ "success": true }))),
        Ok(false) => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Invitation not found or already used" })),
        )),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )),
    }
}

