use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum UserRole {
    SuperAdmin,
    AdminGarderie,
    Educateur,
    Parent,
}

impl std::fmt::Display for UserRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            UserRole::SuperAdmin => "super_admin",
            UserRole::AdminGarderie => "admin_garderie",
            UserRole::Educateur => "educateur",
            UserRole::Parent => "parent",
        };
        write!(f, "{s}")
    }
}

impl std::str::FromStr for UserRole {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "super_admin" => Ok(UserRole::SuperAdmin),
            "admin_garderie" => Ok(UserRole::AdminGarderie),
            "educateur" => Ok(UserRole::Educateur),
            "parent" => Ok(UserRole::Parent),
            _ => Err(anyhow::anyhow!("Unknown role: {s}")),
        }
    }
}

/// DB row struct — role is fetched as TEXT to avoid schema-qualified enum mismatch.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub first_name: String,
    pub last_name: String,
    /// Stored as TEXT in queries (role::TEXT) to bypass SQLx enum OID mismatch.
    pub role: String,
    pub avatar_url: Option<String>,
    pub is_active: bool,
    pub force_password_change: bool,
    pub preferred_locale: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RefreshToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub revoked: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct InvitationToken {
    pub id: Uuid,
    pub email: String,
    pub token: String,
    /// Fetched as TEXT (role::TEXT) for the same OID-mismatch reason as User.role.
    pub role: String,
    pub invited_by: Option<Uuid>,
    pub used: bool,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PushToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub platform: String, // "android" | "ios"
    pub token: String,
    pub created_at: DateTime<Utc>,
}

// Request/Response DTOs
#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub user: UserProfile,
    pub garderie_name: String,
}

#[derive(Debug, Serialize)]
pub struct UserProfile {
    pub id: Uuid,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub role: UserRole,
    pub avatar_url: Option<String>,
    pub force_password_change: bool,
    pub preferred_locale: String,
}

impl From<User> for UserProfile {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            email: u.email,
            first_name: u.first_name,
            last_name: u.last_name,
            role: u.role.parse().unwrap_or(UserRole::Parent),
            avatar_url: u.avatar_url,
            force_password_change: u.force_password_change,
            preferred_locale: u.preferred_locale,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct RegisterFromInviteRequest {
    pub token: String,
    pub first_name: String,
    pub last_name: String,
    pub password: String,
    pub preferred_locale: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct InviteUserRequest {
    pub email: String,
    pub role: UserRole,
}

#[derive(Debug, Deserialize)]
pub struct RefreshTokenRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
pub struct RegisterPushTokenRequest {
    pub platform: String,
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct ForgotPasswordRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct ResetPasswordRequest {
    pub token: String,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
pub struct AdminResetPasswordRequest {
    pub method: Option<String>, // "email" or "temp_password"
}

#[derive(Debug, Deserialize)]
pub struct DeleteUserRequest {
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AdminResetPasswordResponse {
    pub message: String,
    pub temp_password: Option<String>, // Only if method is "temp_password"
}

#[derive(Debug, Deserialize)]
pub struct SendEmailRequest {
    pub subject: String,
    pub body: String,
    pub recipient_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEmailRequest {
    pub new_email: String,
    pub password: String, // Verify password for security
}

/// Response from step 1 of login (before 2FA verification).
#[derive(Debug, Serialize)]
pub struct LoginStep1Response {
    pub status: String, // always "2fa_required"
    pub garderie_name: String,
}

/// Request body for the 2FA verification step.
#[derive(Debug, Deserialize)]
pub struct VerifyTwoFactorRequest {
    pub email: String,
    pub code: String,
}

/// DTO for listing pending invitations.
#[derive(Debug, Clone, Serialize)]
pub struct PendingInvitationDto {
    pub id: Uuid,
    pub email: String,
    pub role: UserRole,
    pub invited_by_id: Option<Uuid>,
    pub invited_by_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}
