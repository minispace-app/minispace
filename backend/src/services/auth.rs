use chrono::Utc;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
    models::{
        auth::{Claims, RefreshClaims},
        user::{
            InvitationToken, LoginResponse, LoginStep1Response, PendingInvitationDto, RefreshToken, User, UserProfile,
            UserRole,
        },
    },
    services::email::EmailService,
};

/// Result of login step 1.
pub enum LoginOutcome {
    TwoFactorRequired(LoginStep1Response),
    Authenticated { response: LoginResponse, device_token: String },
}

fn build_tenant_reset_url(base_url: &str, tenant: &str, token: &str) -> String {
    if let Some(idx) = base_url.find("://") {
        let scheme = &base_url[..idx];
        let domain = &base_url[idx + 3..];
        format!("{scheme}://{tenant}.{domain}/fr/reset-password?token={token}")
    } else {
        format!("https://{tenant}.{base_url}/fr/reset-password?token={token}")
    }
}

fn build_tenant_invite_url(base_url: &str, tenant: &str, token: &str) -> String {
    if let Some(idx) = base_url.find("://") {
        let scheme = &base_url[..idx];
        let domain = &base_url[idx + 3..];
        format!("{scheme}://{tenant}.{domain}/fr/register?token={token}")
    } else {
        format!("https://{tenant}.{base_url}/fr/register?token={token}")
    }
}

pub struct AuthService;

impl AuthService {
    /// Step 1 of login: validate credentials.
    /// If a valid trusted-device cookie is provided, skip 2FA and return tokens directly.
    /// Otherwise send 2FA code by email and return TwoFactorRequired.
    pub async fn login(
        pool: &PgPool,
        email_svc: Option<&EmailService>,
        tenant: &str,
        email: &str,
        password: &str,
        device_token: Option<&str>,
        jwt_secret: &str,
        refresh_secret: &str,
        access_ttl: u64,
        refresh_ttl_days: u64,
    ) -> anyhow::Result<LoginOutcome> {
        let schema = schema_name(tenant);

        // Check if the tenant schema actually exists before querying it.
        let schema_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = $1)"
        )
        .bind(&schema)
        .fetch_one(pool)
        .await?;
        if !schema_exists {
            anyhow::bail!("Garderie introuvable : vérifiez l'identifiant garderie");
        }

        let user = sqlx::query_as::<_, User>(&format!(
            "SELECT id, email, password_hash, first_name, last_name,
                role::TEXT as role, avatar_url, is_active, force_password_change, preferred_locale,
                created_at, updated_at
             FROM {schema}.users WHERE email = $1 AND is_active = TRUE"
        ))
        .bind(email)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Identifiants invalides"))?;

        let valid = bcrypt::verify(password, &user.password_hash)
            .map_err(|_| anyhow::anyhow!("Identifiants invalides"))?;
        if !valid {
            anyhow::bail!("Identifiants invalides");
        }

        // Check trusted device cookie — skip 2FA if valid
        if let Some(cookie_val) = device_token {
            if Self::validate_device_token(pool, &schema, user.id, cookie_val).await {
                let role: UserRole = user.role.parse().unwrap_or(UserRole::Parent);
                let access_token = Self::generate_access_token_with_role(
                    &user, role, tenant, jwt_secret, access_ttl,
                )?;
                let (refresh_token_str, refresh_id) =
                    Self::generate_refresh_token(&user.id, refresh_secret, refresh_ttl_days)?;

                let hash = bcrypt::hash(&refresh_token_str, 8)?;
                let expires_at = Utc::now() + chrono::Duration::days(refresh_ttl_days as i64);
                sqlx::query(&format!(
                    "INSERT INTO {schema}.refresh_tokens (id, user_id, token_hash, expires_at)
                     VALUES ($1, $2, $3, $4)"
                ))
                .bind(refresh_id)
                .bind(user.id)
                .bind(hash)
                .bind(expires_at)
                .execute(pool)
                .await?;

                let garderie_name: Option<String> = sqlx::query_scalar(
                    "SELECT name FROM public.garderies WHERE slug = $1"
                )
                .bind(tenant)
                .fetch_optional(pool)
                .await
                .ok()
                .flatten();

                // Issue a fresh device token (rolling 30-day window)
                let new_device_token =
                    Self::generate_device_token(pool, &schema, user.id).await?;

                return Ok(LoginOutcome::Authenticated {
                    response: LoginResponse {
                        access_token,
                        refresh_token: refresh_token_str,
                        user: user.into(),
                        garderie_name: garderie_name.unwrap_or_else(|| tenant.to_string()),
                    },
                    device_token: new_device_token,
                });
            }
        }

        // No valid trusted device — require 2FA
        let email_svc = email_svc
            .ok_or_else(|| anyhow::anyhow!("Service email non configuré (SMTP requis pour la 2FA)"))?;

        // Invalidate previous unused 2FA codes for this user
        sqlx::query(&format!(
            "UPDATE {schema}.two_factor_codes SET used = TRUE
             WHERE user_id = $1 AND used = FALSE"
        ))
        .bind(user.id)
        .execute(pool)
        .await?;

        // Generate 6-digit code
        use rand::Rng;
        let code: u32 = rand::thread_rng().gen_range(100000..=999999);
        let code_str = format!("{code}");
        let expires_at = Utc::now() + chrono::Duration::minutes(15);

        sqlx::query(&format!(
            "INSERT INTO {schema}.two_factor_codes (user_id, code, expires_at)
             VALUES ($1, $2, $3)"
        ))
        .bind(user.id)
        .bind(&code_str)
        .bind(expires_at)
        .execute(pool)
        .await?;

        let garderie_name: String = sqlx::query_scalar(
            "SELECT name FROM public.garderies WHERE slug = $1"
        )
        .bind(tenant)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| tenant.to_string());

        // Send the code — not a graceful degradation here; 2FA is mandatory
        email_svc
            .send_2fa_code(email, &code_str, &garderie_name)
            .await
            .map_err(|e| anyhow::anyhow!("Impossible d'envoyer le code 2FA : {e}"))?;

        Ok(LoginOutcome::TwoFactorRequired(LoginStep1Response {
            status: "2fa_required".to_string(),
            garderie_name,
        }))
    }

    /// Generate a new trusted device token, store its hash, return cookie value.
    /// Format: "{uuid}.{random48}" — uuid is the DB row ID for fast lookup.
    async fn generate_device_token(pool: &PgPool, schema: &str, user_id: Uuid) -> anyhow::Result<String> {
        use rand::Rng;
        let id = Uuid::new_v4();
        let secret: String = rand::thread_rng()
            .sample_iter(&rand::distributions::Alphanumeric)
            .take(48)
            .map(char::from)
            .collect();
        let cookie_value = format!("{id}.{secret}");
        let hash = bcrypt::hash(&secret, 8)?;
        let expires_at = Utc::now() + chrono::Duration::days(30);
        sqlx::query(&format!(
            "INSERT INTO {schema}.trusted_devices (id, user_id, token_hash, expires_at)
             VALUES ($1, $2, $3, $4)"
        ))
        .bind(id)
        .bind(user_id)
        .bind(hash)
        .bind(expires_at)
        .execute(pool)
        .await?;
        Ok(cookie_value)
    }

    /// Validate a device token cookie value against the DB. Returns true if valid.
    async fn validate_device_token(pool: &PgPool, schema: &str, user_id: Uuid, cookie_value: &str) -> bool {
        let parts: Vec<&str> = cookie_value.splitn(2, '.').collect();
        if parts.len() != 2 { return false; }
        let id: Uuid = match parts[0].parse() {
            Ok(u) => u,
            Err(_) => return false,
        };
        let secret = parts[1];
        let row: Option<(String,)> = sqlx::query_as(&format!(
            "SELECT token_hash FROM {schema}.trusted_devices
             WHERE id = $1 AND user_id = $2 AND expires_at > NOW()"
        ))
        .bind(id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);
        match row {
            Some((hash,)) => bcrypt::verify(secret, &hash).unwrap_or(false),
            None => false,
        }
    }

    /// Revoke a trusted device by cookie value (best-effort, does not fail if missing).
    async fn revoke_device_token(pool: &PgPool, schema: &str, cookie_value: &str) {
        let parts: Vec<&str> = cookie_value.splitn(2, '.').collect();
        if parts.len() != 2 { return; }
        let id: Uuid = match parts[0].parse() {
            Ok(u) => u,
            Err(_) => return,
        };
        let _ = sqlx::query(&format!(
            "DELETE FROM {schema}.trusted_devices WHERE id = $1"
        ))
        .bind(id)
        .execute(pool)
        .await;
    }

    /// Step 2 of login: verify the 2FA code, return JWT pair + new device token cookie value.
    pub async fn verify_2fa(
        pool: &PgPool,
        tenant: &str,
        email: &str,
        code: &str,
        jwt_secret: &str,
        refresh_secret: &str,
        access_ttl: u64,
        refresh_ttl_days: u64,
    ) -> anyhow::Result<(LoginResponse, String)> {
        let schema = schema_name(tenant);

        let user = sqlx::query_as::<_, User>(&format!(
            "SELECT id, email, password_hash, first_name, last_name,
                role::TEXT as role, avatar_url, is_active, force_password_change, preferred_locale,
                created_at, updated_at
             FROM {schema}.users WHERE email = $1 AND is_active = TRUE"
        ))
        .bind(email)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Identifiants invalides"))?;

        // Fetch the most recent active code for this user
        let row: Option<(Uuid, String, i16)> = sqlx::query_as(&format!(
            "SELECT id, code, attempts FROM {schema}.two_factor_codes
             WHERE user_id = $1 AND used = FALSE AND expires_at > NOW()
             ORDER BY created_at DESC LIMIT 1"
        ))
        .bind(user.id)
        .fetch_optional(pool)
        .await?;

        let (code_id, stored_code, attempts) =
            row.ok_or_else(|| anyhow::anyhow!("Code invalide ou expiré. Veuillez vous reconnecter."))?;

        if attempts >= 3 {
            anyhow::bail!("Trop de tentatives. Veuillez vous reconnecter pour obtenir un nouveau code.");
        }

        // Increment attempts
        sqlx::query(&format!(
            "UPDATE {schema}.two_factor_codes SET attempts = attempts + 1 WHERE id = $1"
        ))
        .bind(code_id)
        .execute(pool)
        .await?;

        if code != stored_code {
            anyhow::bail!("Code invalide");
        }

        // Mark code as used
        sqlx::query(&format!(
            "UPDATE {schema}.two_factor_codes SET used = TRUE WHERE id = $1"
        ))
        .bind(code_id)
        .execute(pool)
        .await?;

        // Issue tokens
        let role: UserRole = user.role.parse().unwrap_or(UserRole::Parent);
        let access_token = Self::generate_access_token_with_role(&user, role, tenant, jwt_secret, access_ttl)?;
        let (refresh_token_str, refresh_id) =
            Self::generate_refresh_token(&user.id, refresh_secret, refresh_ttl_days)?;

        let hash = bcrypt::hash(&refresh_token_str, 8)?;
        let expires_at = Utc::now() + chrono::Duration::days(refresh_ttl_days as i64);

        sqlx::query(&format!(
            "INSERT INTO {schema}.refresh_tokens (id, user_id, token_hash, expires_at)
             VALUES ($1, $2, $3, $4)"
        ))
        .bind(refresh_id)
        .bind(user.id)
        .bind(hash)
        .bind(expires_at)
        .execute(pool)
        .await?;

        let garderie_name: Option<String> = sqlx::query_scalar(
            "SELECT name FROM public.garderies WHERE slug = $1"
        )
        .bind(tenant)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

        // Generate and store a trusted device token
        let device_token = Self::generate_device_token(pool, &schema, user.id)
            .await
            .unwrap_or_default();

        Ok((
            LoginResponse {
                access_token,
                refresh_token: refresh_token_str,
                user: user.into(),
                garderie_name: garderie_name.unwrap_or_else(|| tenant.to_string()),
            },
            device_token,
        ))
    }

    pub fn generate_access_token(
        user: &User,
        tenant: &str,
        secret: &str,
        ttl_seconds: u64,
    ) -> anyhow::Result<String> {
        let role: UserRole = user.role.parse().unwrap_or(UserRole::Parent);
        Self::generate_access_token_with_role(user, role, tenant, secret, ttl_seconds)
    }

    pub fn generate_access_token_with_role(
        user: &User,
        role: UserRole,
        tenant: &str,
        secret: &str,
        ttl_seconds: u64,
    ) -> anyhow::Result<String> {
        let now = Utc::now().timestamp() as usize;
        let claims = Claims {
            sub: user.id.to_string(),
            tenant: tenant.to_string(),
            role,
            iat: now,
            exp: now + ttl_seconds as usize,
        };
        let token = encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(secret.as_bytes()),
        )?;
        Ok(token)
    }

    fn generate_refresh_token(
        user_id: &Uuid,
        secret: &str,
        ttl_days: u64,
    ) -> anyhow::Result<(String, Uuid)> {
        let now = Utc::now().timestamp() as usize;
        let jti = Uuid::new_v4();
        let claims = RefreshClaims {
            sub: user_id.to_string(),
            jti: jti.to_string(),
            iat: now,
            exp: now + (ttl_days * 86400) as usize,
        };
        let token = encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(secret.as_bytes()),
        )?;
        Ok((token, jti))
    }

    /// Rotate refresh token: revoke old, issue new pair.
    pub async fn refresh(
        pool: &PgPool,
        tenant: &str,
        refresh_token_str: &str,
        jwt_secret: &str,
        refresh_secret: &str,
        access_ttl: u64,
        refresh_ttl_days: u64,
    ) -> anyhow::Result<LoginResponse> {
        use jsonwebtoken::{decode, DecodingKey, Validation};

        let key = DecodingKey::from_secret(refresh_secret.as_bytes());
        let data = decode::<RefreshClaims>(
            refresh_token_str,
            &key,
            &Validation::new(Algorithm::HS256),
        )?;
        let rc = data.claims;
        let jti: Uuid = rc.jti.parse()?;
        let user_id: Uuid = rc.sub.parse()?;

        let schema = schema_name(tenant);

        // Fetch the stored token
        let stored: RefreshToken = sqlx::query_as(&format!(
            "SELECT * FROM {schema}.refresh_tokens WHERE id = $1 AND revoked = FALSE"
        ))
        .bind(jti)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Refresh token not found or revoked"))?;

        if stored.expires_at < Utc::now() {
            anyhow::bail!("Refresh token expired");
        }
        if !bcrypt::verify(refresh_token_str, &stored.token_hash)? {
            anyhow::bail!("Refresh token invalid");
        }

        // Revoke old token
        sqlx::query(&format!(
            "UPDATE {schema}.refresh_tokens SET revoked = TRUE WHERE id = $1"
        ))
        .bind(jti)
        .execute(pool)
        .await?;

        // Fetch user
        let user = sqlx::query_as::<_, User>(&format!(
            "SELECT id, email, password_hash, first_name, last_name,
                role::TEXT as role, avatar_url, is_active, force_password_change, preferred_locale,
                created_at, updated_at
             FROM {schema}.users WHERE id = $1 AND is_active = TRUE"
        ))
        .bind(user_id)
        .fetch_one(pool)
        .await?;

        let access_token = Self::generate_access_token(&user, tenant, jwt_secret, access_ttl)?;
        let (new_refresh, new_jti) =
            Self::generate_refresh_token(&user.id, refresh_secret, refresh_ttl_days)?;

        let hash = bcrypt::hash(&new_refresh, 8)?;
        let expires_at = Utc::now() + chrono::Duration::days(refresh_ttl_days as i64);

        sqlx::query(&format!(
            "INSERT INTO {schema}.refresh_tokens (id, user_id, token_hash, expires_at)
             VALUES ($1, $2, $3, $4)"
        ))
        .bind(new_jti)
        .bind(user.id)
        .bind(hash)
        .bind(expires_at)
        .execute(pool)
        .await?;

        let garderie_name: Option<String> = sqlx::query_scalar(
            "SELECT name FROM public.garderies WHERE slug = $1"
        )
        .bind(tenant)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

        Ok(LoginResponse {
            access_token,
            refresh_token: new_refresh,
            user: user.into(),
            garderie_name: garderie_name.unwrap_or_else(|| tenant.to_string()),
        })
    }

    /// Revoke a refresh token and trusted device token (logout).
    pub async fn logout(
        pool: &PgPool,
        tenant: &str,
        refresh_token_str: &str,
        refresh_secret: &str,
        device_token: Option<&str>,
    ) -> anyhow::Result<()> {
        use jsonwebtoken::{decode, DecodingKey, Validation};

        let schema = schema_name(tenant);

        let key = DecodingKey::from_secret(refresh_secret.as_bytes());
        let data =
            decode::<RefreshClaims>(refresh_token_str, &key, &Validation::new(Algorithm::HS256));

        if let Ok(data) = data {
            let jti: Uuid = data.claims.jti.parse()?;
            sqlx::query(&format!(
                "UPDATE {schema}.refresh_tokens SET revoked = TRUE WHERE id = $1"
            ))
            .bind(jti)
            .execute(pool)
            .await?;
        }

        if let Some(cookie_val) = device_token {
            Self::revoke_device_token(pool, &schema, cookie_val).await;
        }

        Ok(())
    }

    /// Create an invitation token and send the invitation email.
    pub async fn create_invitation(
        pool: &PgPool,
        email_svc: Option<&EmailService>,
        tenant: &str,
        email: &str,
        role: UserRole,
        invited_by: Option<Uuid>,
        base_url: &str,
    ) -> anyhow::Result<()> {
        let email_svc = email_svc
            .ok_or_else(|| anyhow::anyhow!("Service email non configuré (SMTP requis pour les invitations)"))?;

        use rand::Rng;
        let schema = schema_name(tenant);
        let token: String = rand::thread_rng()
            .sample_iter(&rand::distributions::Alphanumeric)
            .take(48)
            .map(char::from)
            .collect();

        let expires_at = Utc::now() + chrono::Duration::days(7);

        sqlx::query(&format!(
            "INSERT INTO {schema}.invitation_tokens (email, token, role, invited_by, expires_at)
             VALUES ($1, $2, $3::\"{schema}\".user_role, $4, $5)"
        ))
        .bind(email)
        .bind(&token)
        .bind(role.to_string())
        .bind(invited_by)
        .bind(expires_at)
        .execute(pool)
        .await?;

        let garderie_name: String = sqlx::query_scalar(
            "SELECT name FROM public.garderies WHERE slug = $1"
        )
        .bind(tenant)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| tenant.to_string());

        let invite_url = build_tenant_invite_url(base_url, tenant, &token);

        email_svc
            .send_invitation(email, &invite_url, &garderie_name, &role.to_string())
            .await
            .map_err(|e| anyhow::anyhow!("Impossible d'envoyer l'invitation : {e}"))?;

        Ok(())
    }

    /// Send a password reset email. Always returns Ok to avoid leaking account existence.
    pub async fn request_password_reset(
        pool: &PgPool,
        email_svc: Option<&EmailService>,
        tenant: &str,
        email: &str,
        base_url: &str,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);

        let user_opt: Option<(Uuid, String, String)> = sqlx::query_as(&format!(
            "SELECT id, first_name, last_name FROM {schema}.users
             WHERE email = $1 AND is_active = TRUE"
        ))
        .bind(email)
        .fetch_optional(pool)
        .await?;

        if let Some((user_id, first_name, last_name)) = user_opt {
            use rand::Rng;
            let token: String = rand::thread_rng()
                .sample_iter(&rand::distributions::Alphanumeric)
                .take(48)
                .map(char::from)
                .collect();

            let expires_at = Utc::now() + chrono::Duration::hours(1);

            sqlx::query(&format!(
                "INSERT INTO {schema}.password_reset_tokens (user_id, token, expires_at)
                 VALUES ($1, $2, $3)"
            ))
            .bind(user_id)
            .bind(&token)
            .bind(expires_at)
            .execute(pool)
            .await?;

            if let Some(svc) = email_svc {
                let garderie_name: String = sqlx::query_scalar(
                    "SELECT name FROM public.garderies WHERE slug = $1"
                )
                .bind(tenant)
                .fetch_optional(pool)
                .await
                .ok()
                .flatten()
                .unwrap_or_else(|| tenant.to_string());

                let reset_url = build_tenant_reset_url(base_url, tenant, &token);
                let display_name = format!("{first_name} {last_name}");
                // Ignore send errors — graceful degradation
                let _ = svc
                    .send_password_reset(email, &display_name, &reset_url, &garderie_name)
                    .await;
            }
        }

        Ok(())
    }

    /// Verify token, hash new password, revoke all refresh tokens, mark token used.
    pub async fn reset_password(
        pool: &PgPool,
        tenant: &str,
        token_str: &str,
        new_password: &str,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);

        let row: Option<(Uuid, Uuid)> = sqlx::query_as(&format!(
            "SELECT id, user_id FROM {schema}.password_reset_tokens
             WHERE token = $1 AND used = FALSE AND expires_at > NOW()"
        ))
        .bind(token_str)
        .fetch_optional(pool)
        .await?;

        let (token_id, user_id) =
            row.ok_or_else(|| anyhow::anyhow!("Token invalide ou expiré"))?;

        let password_hash = bcrypt::hash(new_password, 12)?;

        sqlx::query(&format!(
            "UPDATE {schema}.users SET password_hash = $1, force_password_change = FALSE WHERE id = $2"
        ))
        .bind(&password_hash)
        .bind(user_id)
        .execute(pool)
        .await?;

        sqlx::query(&format!(
            "UPDATE {schema}.refresh_tokens SET revoked = TRUE WHERE user_id = $1"
        ))
        .bind(user_id)
        .execute(pool)
        .await?;

        sqlx::query(&format!(
            "UPDATE {schema}.password_reset_tokens SET used = TRUE WHERE id = $1"
        ))
        .bind(token_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Register a user from an invitation token.
    pub async fn register_from_invite(
        pool: &PgPool,
        tenant: &str,
        token_str: &str,
        first_name: &str,
        last_name: &str,
        password: &str,
        preferred_locale: &str,
    ) -> anyhow::Result<UserProfile> {
        let schema = schema_name(tenant);

        let invite: InvitationToken = sqlx::query_as(&format!(
            "SELECT id, email, token, role::TEXT as role, invited_by, used, expires_at, created_at
             FROM {schema}.invitation_tokens WHERE token = $1 AND used = FALSE"
        ))
        .bind(token_str)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Invalid or already-used invitation token"))?;

        if invite.expires_at < Utc::now() {
            anyhow::bail!("Invitation token expired");
        }

        let password_hash = bcrypt::hash(password, 12)?;

        let user: User = sqlx::query_as(&format!(
            "INSERT INTO {schema}.users (email, password_hash, first_name, last_name, role, preferred_locale)
             VALUES ($1, $2, $3, $4, $5::\"{schema}\".user_role, $6)
             RETURNING id, email, password_hash, first_name, last_name,
                       role::TEXT as role, avatar_url, is_active, force_password_change,
                       preferred_locale, created_at, updated_at"
        ))
        .bind(&invite.email)
        .bind(password_hash)
        .bind(first_name)
        .bind(last_name)
        .bind(&invite.role)
        .bind(preferred_locale)
        .fetch_one(pool)
        .await?;

        // Mark invite as used
        sqlx::query(&format!(
            "UPDATE {schema}.invitation_tokens SET used = TRUE WHERE id = $1"
        ))
        .bind(invite.id)
        .execute(pool)
        .await?;

        Ok(user.into())
    }

    /// Admin-initiated password reset: generate temp password or send reset email link.
    /// Returns (message, optional_temp_password)
    pub async fn reset_user_password_as_admin(
        pool: &PgPool,
        email_svc: Option<&EmailService>,
        tenant: &str,
        target_user_id: Uuid,
        method: Option<&str>, // "email" or "temp_password"
        base_url: &str,
    ) -> anyhow::Result<(String, Option<String>)> {
        let schema = schema_name(tenant);
        let method = method.unwrap_or("email");

        // Fetch target user details
        let user_opt: Option<(String, String, String)> = sqlx::query_as(&format!(
            "SELECT email, first_name, last_name FROM {schema}.users WHERE id = $1 AND is_active = TRUE"
        ))
        .bind(target_user_id)
        .fetch_optional(pool)
        .await?;

        let (email, first_name, last_name) = user_opt
            .ok_or_else(|| anyhow::anyhow!("Utilisateur non trouvé"))?;

        if method == "temp_password" {
            // Generate and set a temporary password
            use rand::Rng;
            let temp_password: String = rand::thread_rng()
                .sample_iter(&rand::distributions::Alphanumeric)
                .take(12)
                .map(char::from)
                .collect();

            let password_hash = bcrypt::hash(&temp_password, 12)?;

            sqlx::query(&format!(
                "UPDATE {schema}.users SET password_hash = $1, force_password_change = TRUE WHERE id = $2"
            ))
            .bind(&password_hash)
            .bind(target_user_id)
            .execute(pool)
            .await?;

            // Revoke all refresh tokens for this user
            sqlx::query(&format!(
                "UPDATE {schema}.refresh_tokens SET revoked = TRUE WHERE user_id = $1"
            ))
            .bind(target_user_id)
            .execute(pool)
            .await?;

            return Ok((
                format!("Mot de passe temporaire généré pour {email}"),
                Some(temp_password),
            ));
        } else {
            // Generate reset token and send email link
            use rand::Rng;
            let token: String = rand::thread_rng()
                .sample_iter(&rand::distributions::Alphanumeric)
                .take(48)
                .map(char::from)
                .collect();

            let expires_at = Utc::now() + chrono::Duration::hours(1);

            sqlx::query(&format!(
                "INSERT INTO {schema}.password_reset_tokens (user_id, token, expires_at)
                 VALUES ($1, $2, $3)"
            ))
            .bind(target_user_id)
            .bind(&token)
            .bind(expires_at)
            .execute(pool)
            .await?;

            if let Some(svc) = email_svc {
                let garderie_name: String = sqlx::query_scalar(
                    "SELECT name FROM public.garderies WHERE slug = $1"
                )
                .bind(tenant)
                .fetch_optional(pool)
                .await
                .ok()
                .flatten()
                .unwrap_or_else(|| tenant.to_string());

                let reset_url = build_tenant_reset_url(base_url, tenant, &token);
                let display_name = format!("{first_name} {last_name}");
                // Ignore send errors — graceful degradation
                let _ = svc
                    .send_password_reset(&email, &display_name, &reset_url, &garderie_name)
                    .await;
            }

            return Ok((
                format!("Email de réinitialisation envoyé à {email}"),
                None,
            ));
        }
    }

    /// Change user's password (requires current password verification).
    pub async fn change_password(
        pool: &PgPool,
        tenant: &str,
        user_id: Uuid,
        current_password: &str,
        new_password: &str,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);

        // Fetch current password hash
        let password_hash: String = sqlx::query_scalar(&format!(
            "SELECT password_hash FROM {schema}.users WHERE id = $1 AND is_active = TRUE"
        ))
        .bind(user_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Utilisateur non trouvé"))?;

        // Verify current password
        let valid = bcrypt::verify(current_password, &password_hash)
            .map_err(|_| anyhow::anyhow!("Mot de passe actuel incorrect"))?;
        if !valid {
            anyhow::bail!("Mot de passe actuel incorrect");
        }

        // Hash and update new password
        let new_hash = bcrypt::hash(new_password, 12)?;
        sqlx::query(&format!(
            "UPDATE {schema}.users SET password_hash = $1, updated_at = NOW(), force_password_change = FALSE WHERE id = $2"
        ))
        .bind(&new_hash)
        .bind(user_id)
        .execute(pool)
        .await?;

        // Revoke all refresh tokens to force re-login
        sqlx::query(&format!(
            "UPDATE {schema}.refresh_tokens SET revoked = TRUE WHERE user_id = $1"
        ))
        .bind(user_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Update user's email (requires password verification).
    pub async fn update_email(
        pool: &PgPool,
        tenant: &str,
        user_id: Uuid,
        new_email: &str,
        password: &str,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);

        // Fetch current password hash
        let password_hash: String = sqlx::query_scalar(&format!(
            "SELECT password_hash FROM {schema}.users WHERE id = $1 AND is_active = TRUE"
        ))
        .bind(user_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Utilisateur non trouvé"))?;

        // Diagnostic log (no password value)
        tracing::info!("update_email: verifying password for user_id={} in tenant={}", user_id, tenant);

        // Verify password
        let valid = match bcrypt::verify(password, &password_hash) {
            Ok(v) => v,
            Err(e) => {
                tracing::error!("update_email: bcrypt verify error for user_id={}: {}", user_id, e);
                anyhow::bail!("Mot de passe incorrect");
            }
        };
        if !valid {
            tracing::info!("update_email: password mismatch for user_id={}", user_id);
            anyhow::bail!("Mot de passe incorrect");
        }
        tracing::info!("update_email: password verified for user_id={}", user_id);

        // Check if email already exists in same tenant
        let exists: bool = sqlx::query_scalar(&format!(
            "SELECT EXISTS(SELECT 1 FROM {schema}.users WHERE email = $1 AND id != $2)"
        ))
        .bind(new_email)
        .bind(user_id)
        .fetch_one(pool)
        .await?;

        if exists {
            anyhow::bail!("Cet email est déjà utilisé");
        }

        // Update email
        sqlx::query(&format!(
            "UPDATE {schema}.users SET email = $1, updated_at = NOW() WHERE id = $2"
        ))
        .bind(new_email)
        .bind(user_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// List all pending (unused) invitations for a tenant.
    pub async fn list_pending_invitations(
        pool: &PgPool,
        tenant: &str,
    ) -> anyhow::Result<Vec<PendingInvitationDto>> {
        let schema = schema_name(tenant);

        let rows = sqlx::query(&format!(
            r#"
            SELECT 
                it.id,
                it.email,
                it.role::TEXT as role,
                it.invited_by,
                u.first_name,
                u.last_name,
                it.created_at,
                it.expires_at
            FROM {schema}.invitation_tokens it
            LEFT JOIN {schema}.users u ON it.invited_by = u.id
            WHERE it.used = FALSE AND it.expires_at > NOW()
            ORDER BY it.created_at DESC
            "#
        ))
        .fetch_all(pool)
        .await?;

        let invitations = rows
            .into_iter()
            .map(|row| {
                let role_str: String = row.get("role");
                let invited_by_id: Option<Uuid> = row.get("invited_by");
                let first_name: Option<String> = row.get("first_name");
                let last_name: Option<String> = row.get("last_name");

                let invited_by_name = match (first_name, last_name) {
                    (Some(f), Some(l)) => Some(format!("{} {}", f, l)),
                    _ => None,
                };

                PendingInvitationDto {
                    id: row.get("id"),
                    email: row.get("email"),
                    role: role_str.parse().unwrap_or(UserRole::Parent),
                    invited_by_id,
                    invited_by_name,
                    created_at: row.get("created_at"),
                    expires_at: row.get("expires_at"),
                }
            })
            .collect();

        Ok(invitations)
    }

    /// Delete a pending invitation by ID (only if not yet used).
    pub async fn delete_invitation(
        pool: &PgPool,
        tenant: &str,
        invitation_id: Uuid,
    ) -> anyhow::Result<bool> {
        let schema = schema_name(tenant);

        let result = sqlx::query(&format!(
            "DELETE FROM {schema}.invitation_tokens WHERE id = $1 AND used = FALSE"
        ))
        .bind(invitation_id)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }
}
