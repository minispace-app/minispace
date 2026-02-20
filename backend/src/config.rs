use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    pub jwt_secret: String,
    pub jwt_refresh_secret: String,
    pub jwt_expiry_seconds: u64,
    pub jwt_refresh_expiry_days: u64,
    pub media_dir: String,
    pub host: String,
    pub port: u16,
    pub fcm_api_key: Option<String>,
    pub apns_key_path: Option<String>,
    pub apns_key_id: Option<String>,
    pub apns_team_id: Option<String>,
    pub app_bundle_id: String,
    pub super_admin_key: String,
    pub app_base_url: String,
    // SMTP (optional)
    pub smtp_host: Option<String>,
    pub smtp_port: Option<u16>,
    pub smtp_username: Option<String>,
    pub smtp_password: Option<String>,
    pub smtp_from: Option<String>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            database_url: required("DATABASE_URL")?,
            redis_url: env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into()),
            jwt_secret: required("JWT_SECRET")?,
            jwt_refresh_secret: required("JWT_REFRESH_SECRET")?,
            jwt_expiry_seconds: env::var("JWT_EXPIRY_SECONDS")
                .unwrap_or_else(|_| "900".into())
                .parse()?,
            jwt_refresh_expiry_days: env::var("JWT_REFRESH_EXPIRY_DAYS")
                .unwrap_or_else(|_| "30".into())
                .parse()?,
            media_dir: env::var("MEDIA_DIR").unwrap_or_else(|_| "/data/media".into()),
            host: env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: env::var("PORT")
                .unwrap_or_else(|_| "8080".into())
                .parse()?,
            fcm_api_key: env::var("FCM_API_KEY").ok().filter(|s| !s.is_empty()),
            apns_key_path: env::var("APNS_KEY_PATH").ok().filter(|s| !s.is_empty()),
            apns_key_id: env::var("APNS_KEY_ID").ok().filter(|s| !s.is_empty()),
            apns_team_id: env::var("APNS_TEAM_ID").ok().filter(|s| !s.is_empty()),
            app_bundle_id: env::var("APP_BUNDLE_ID")
                .unwrap_or_else(|_| "app.minispace.app".into()),
            super_admin_key: env::var("SUPER_ADMIN_KEY")
                .unwrap_or_else(|_| "change_this_super_admin_key".into()),
            app_base_url: env::var("APP_BASE_URL")
                .unwrap_or_else(|_| "http://localhost".into()),
            smtp_host: env::var("SMTP_HOST").ok().filter(|s| !s.is_empty()),
            smtp_port: env::var("SMTP_PORT").ok().and_then(|v| v.parse().ok()),
            smtp_username: env::var("SMTP_USERNAME").ok().filter(|s| !s.is_empty()),
            smtp_password: env::var("SMTP_PASSWORD").ok().filter(|s| !s.is_empty()),
            smtp_from: env::var("SMTP_FROM").ok().filter(|s| !s.is_empty()),
        })
    }
}

fn required(key: &str) -> anyhow::Result<String> {
    env::var(key).map_err(|_| anyhow::anyhow!("Missing required env var: {}", key))
}
