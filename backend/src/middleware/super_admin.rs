use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
};

use crate::AppState;

/// Extractor that validates the `X-Super-Admin-Key` header against `config.super_admin_key`.
pub struct SuperAdminAuth;

impl FromRequestParts<AppState> for SuperAdminAuth {
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let key = parts
            .headers
            .get("X-Super-Admin-Key")
            .and_then(|v| v.to_str().ok())
            .ok_or((StatusCode::UNAUTHORIZED, "Missing X-Super-Admin-Key header"))?;

        if key != state.config.super_admin_key {
            return Err((StatusCode::UNAUTHORIZED, "Invalid super-admin key"));
        }

        Ok(SuperAdminAuth)
    }
}
