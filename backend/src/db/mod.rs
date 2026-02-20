pub mod tenant;

use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

pub async fn create_pool(database_url: &str) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(database_url)
        .await?;
    Ok(pool)
}

/// Run the public-schema migrations embedded in ./migrations/
pub async fn run_migrations(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}

/// Re-provision all active tenant schemas (idempotent — safe to call on every startup).
pub async fn migrate_all_existing_tenants(pool: &PgPool) -> anyhow::Result<()> {
    let slugs: Vec<String> = sqlx::query_scalar(
        "SELECT slug FROM garderies WHERE is_active = TRUE"
    )
    .fetch_all(pool)
    .await?;

    for slug in slugs {
        tenant::provision_tenant_schema(pool, &slug).await?;
        tracing::info!("Migrated tenant schema: garderie_{}", slug.to_lowercase().replace('-', "_"));
    }
    Ok(())
}
