mod config;
mod db;
mod middleware;
mod models;
mod routes;
mod services;

use std::sync::Arc;

use axum::{
    extract::DefaultBodyLimit,
    http::{header, HeaderValue, Method},
    routing::{delete, get, post, put},
    Router,
};
use redis::Client as RedisClient;
use sqlx::PgPool;
use tower_http::cors::{AllowHeaders, AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use config::Config;
use middleware::auth::JwtSecret;
use services::email::EmailService;
use services::notifications::NotificationService;

/// Application state shared across all handlers.
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub redis: redis::aio::MultiplexedConnection,
    pub redis_client: RedisClient,
    pub config: Arc<Config>,
    pub notifications: Arc<NotificationService>,
    pub email: Option<Arc<EmailService>>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env()?;
    let config = Arc::new(config);

    let pool = db::create_pool(&config.database_url).await?;
    db::run_migrations(&pool).await?;
    db::migrate_all_existing_tenants(&pool).await?;
    info!("Database connected and migrations applied");

    let redis_client = RedisClient::open(config.redis_url.as_str())?;
    let redis_conn = redis_client
        .get_multiplexed_async_connection()
        .await?;
    info!("Redis connected");

    let notifications = Arc::new(NotificationService::new(config.fcm_api_key.clone()));

    let email = EmailService::new(&config).map(Arc::new);
    if email.is_some() {
        info!("SMTP email service configured");
    } else {
        info!("SMTP not configured — email features disabled");
    }

    let state = AppState {
        db: pool,
        redis: redis_conn,
        redis_client: redis_client.clone(),
        config: config.clone(),
        notifications,
        email,
    };

    // Build CORS: allow the app base domain and its subdomains (tenant subdomains).
    // In development (localhost), all origins are allowed.
    let base_url = config.app_base_url.clone();
    let cors_origin = {
        let base = base_url.clone();
        AllowOrigin::predicate(move |origin: &HeaderValue, _| {
            let o = match origin.to_str() {
                Ok(s) => s,
                Err(_) => return false,
            };
            // Always allow localhost / 127.0.0.1 for local development
            if o.starts_with("http://localhost") || o.starts_with("http://127.0.0.1") {
                return true;
            }
            // Exact match of app_base_url
            if o == base {
                return true;
            }
            // Subdomain match: extract domain portion from base URL and allow *.domain
            if let Some(idx) = base.find("://") {
                let after_scheme = &base[idx + 3..];
                let domain = after_scheme.split('/').next().unwrap_or(after_scheme);
                let domain_clean = domain.split(':').next().unwrap_or(domain);
                if o.contains(&format!(".{domain_clean}")) {
                    return true;
                }
            }
            false
        })
    };

    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
        .allow_headers(AllowHeaders::list([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ACCEPT,
            header::HeaderName::from_static("x-tenant"),
            header::HeaderName::from_static("x-super-admin-key"),
        ]))
        .allow_origin(cors_origin);

    let jwt_secret = JwtSecret(config.jwt_secret.clone());

    let app = Router::new()
        .route("/health", get(routes::health::health_check))
        .route("/contact", post(routes::contact::submit_contact))
        .route("/tenant/info", get(routes::tenant_info::get_tenant_info))
        // Auth
        .route("/auth/login", post(routes::auth::login))
        .route("/auth/refresh", post(routes::auth::refresh_token))
        .route("/auth/logout", post(routes::auth::logout))
        .route("/auth/invite", post(routes::auth::invite_user))
        .route("/auth/invitations", get(routes::auth::list_pending_invitations))
        .route("/auth/invitations/{id}", delete(routes::auth::delete_invitation))
        .route("/auth/register", post(routes::auth::register_from_invite))
        .route("/auth/me", get(routes::auth::me))
        .route("/auth/change-password", post(routes::auth::change_password))
        .route("/auth/update-email", post(routes::auth::update_email))
        .route("/auth/push-token", post(routes::auth::register_push_token))
        .route("/auth/verify-2fa", post(routes::auth::verify_2fa))
        .route("/auth/forgot-password", post(routes::auth::forgot_password))
        .route("/auth/reset-password", post(routes::auth::reset_password))
        // Email
        .route("/email/send-to-parents", post(routes::email::send_to_parents))
        // Messages
        .route("/messages", get(routes::messages::list_messages).post(routes::messages::send_message))
        .route("/messages/send-to-parents", post(routes::messages::send_to_parents))
        .route("/messages/{id}/read", post(routes::messages::mark_read))
        .route("/messages/thread/mark-read", post(routes::messages::mark_thread_read))
        .route("/messages/conversation/{user_id}", get(routes::messages::get_conversation))
        .route("/messages/conversations", get(routes::messages::get_conversations))
        .route("/messages/thread/broadcast", get(routes::messages::get_broadcast_thread))
        .route("/messages/thread/group/{group_id}", get(routes::messages::get_group_thread))
        .route("/messages/thread/individual/{parent_id}", get(routes::messages::get_individual_thread))
        // Media
        .route("/media", get(routes::media::list_media).post(routes::media::upload_media))
        .route("/media/bulk", post(routes::media::bulk_media))
        .route("/media/{id}", put(routes::media::update_media).delete(routes::media::delete_media))
        .route("/media/files/{*path}", get(routes::media::serve_media))
        // Documents
        .route("/documents", get(routes::documents::list_documents).post(routes::documents::upload_document))
        .route("/documents/{id}", put(routes::documents::update_document).delete(routes::documents::delete_document))
        // Groups
        .route("/groups", get(routes::groups::list_groups).post(routes::groups::create_group))
        .route("/groups/{id}", put(routes::groups::update_group).delete(routes::groups::delete_group))
        .route("/groups/{id}/children", put(routes::groups::set_group_children))
        // Journal de bord
        .route("/journals", get(routes::journal::get_week).put(routes::journal::upsert_entry))
        .route("/journals/send-all-to-parents", post(routes::journal::send_all_to_parents))
        .route("/journals/{child_id}/send-to-parents", post(routes::journal::send_to_parents))
        // Children
        .route("/children", get(routes::children::list_children).post(routes::children::create_child))
        .route("/children/{id}", put(routes::children::update_child).delete(routes::children::delete_child))
        .route("/children/{id}/parents", get(routes::children::list_parents).post(routes::children::assign_parent))
        .route("/children/{id}/parents/{user_id}", delete(routes::children::remove_parent))
        // WebSocket
        .route("/ws", get(routes::websocket::ws_handler))
        // Tenant user management (admin_garderie)
        .route("/users", get(routes::users::list_users).post(routes::users::create_user))
        .route("/users/{id}", put(routes::users::update_user).delete(routes::users::deactivate_user))
        .route("/users/{id}/reset-password", post(routes::users::reset_user_password))
        // Super-admin
        .route("/super-admin/garderies", get(routes::tenants::list_garderies).post(routes::tenants::create_garderie))
        .route("/super-admin/garderies/{slug}", put(routes::tenants::update_garderie).delete(routes::tenants::delete_garderie))
        .route("/super-admin/garderies/{slug}/users", get(routes::tenants::list_garderie_users).post(routes::tenants::create_garderie_user_body))
        .route("/super-admin/garderies/{slug}/invite", post(routes::tenants::invite_garderie_user))
        .route("/super-admin/garderies/{slug}/users/{user_id}", delete(routes::tenants::deactivate_garderie_user))
        .route("/super-admin/backup", post(routes::tenants::trigger_backup_all))
        .route("/super-admin/backups", get(routes::tenants::list_backups))
        .route("/super-admin/restore", post(routes::tenants::trigger_restore))
        .layer(axum::Extension(jwt_secret))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        // Global body size limit of 100 MB (covers media uploads)
        .layer(DefaultBodyLimit::max(100 * 1024 * 1024))
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    info!("minispace.app API listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
