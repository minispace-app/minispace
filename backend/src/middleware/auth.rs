use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};

use crate::models::auth::{AuthenticatedUser, Claims};
use crate::models::user::UserRole;

impl<S> FromRequestParts<S> for AuthenticatedUser
where
    S: Send + Sync,
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or((StatusCode::UNAUTHORIZED, "Missing Authorization header"))?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or((StatusCode::UNAUTHORIZED, "Invalid Authorization header format"))?;

        let secret = parts
            .extensions
            .get::<JwtSecret>()
            .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "JWT secret not configured"))?;

        let user = decode_access_token(token, &secret.0)
            .map_err(|_| (StatusCode::UNAUTHORIZED, "Invalid or expired token"))?;

        // Cross-tenant IDOR prevention: if an X-Tenant header is present and the user
        // is not a super-admin, the JWT tenant must match the requested tenant.
        if user.role != UserRole::SuperAdmin {
            if let Some(x_tenant) = parts
                .headers
                .get("X-Tenant")
                .and_then(|v| v.to_str().ok())
            {
                let x_tenant_lower = x_tenant.to_lowercase();
                if user.tenant != x_tenant_lower {
                    return Err((StatusCode::FORBIDDEN, "Tenant mismatch"));
                }
            }
        }

        Ok(user)
    }
}

/// Extension type to carry the JWT secret through request extensions.
#[derive(Clone)]
pub struct JwtSecret(pub String);

pub fn decode_access_token(token: &str, secret: &str) -> Result<AuthenticatedUser, anyhow::Error> {
    let key = DecodingKey::from_secret(secret.as_bytes());
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;

    let data = decode::<Claims>(token, &key, &validation)?;
    let claims = data.claims;

    Ok(AuthenticatedUser {
        user_id: claims.sub.parse()?,
        tenant: claims.tenant,
        role: claims.role,
    })
}
