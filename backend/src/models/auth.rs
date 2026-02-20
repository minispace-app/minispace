use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::user::UserRole;

/// Claims embedded in the JWT access token
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,   // user UUID
    pub tenant: String, // garderie slug
    pub role: UserRole,
    pub exp: usize,
    pub iat: usize,
}

/// Claims embedded in the JWT refresh token
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshClaims {
    pub sub: String,  // user UUID
    pub jti: String,  // refresh token UUID (to enable revocation)
    pub exp: usize,
    pub iat: usize,
}

/// Extracted from the validated JWT — available via Axum extractors
#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    pub user_id: Uuid,
    pub tenant: String,
    pub role: UserRole,
}
