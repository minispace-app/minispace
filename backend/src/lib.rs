// Library exports for binary tools and tests
pub mod config;
pub mod db;
pub mod middleware;
pub mod models;
pub mod routes;
pub mod services;

use std::sync::Arc;

use redis::Client as RedisClient;
use sqlx::PgPool;

use config::Config;
use services::email::EmailService;
use services::notifications::NotificationService;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub redis: redis::aio::MultiplexedConnection,
    pub redis_client: RedisClient,
    pub config: Arc<Config>,
    pub notifications: Arc<NotificationService>,
    pub email: Option<Arc<EmailService>>,
}
