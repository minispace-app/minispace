/// Purge expired data based on retention policy
/// Run daily (e.g., via cron job: 0 2 * * * /app/purge-data)
///
/// Usage: purge-data [--tenant SLUG]
///   --tenant SLUG  : Purge only this tenant (optional, all if not specified)

use clap::Parser;
use sqlx::postgres::PgPoolOptions;
use tracing_subscriber;

#[derive(Parser)]
#[command(name = "purge-data", about = "Purge expired data from minispace database")]
struct Args {
    /// Tenant slug to purge (optional, all if not specified)
    #[arg(long)]
    tenant: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    let args = Args::parse();

    // Get database URL from environment
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL environment variable not set");

    // Create database connection pool
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    tracing::info!("Starting data purge job...");

    if let Some(tenant) = args.tenant {
        // Purge specific tenant
        minispace_api::services::cron::CronService::purge_expired_data(&pool, &tenant).await?;
        tracing::info!("Completed purge for tenant: {}", tenant);
    } else {
        // Purge all active garderies
        let garderies: Vec<String> = sqlx::query_scalar(
            "SELECT slug FROM public.garderies WHERE is_active = TRUE"
        )
        .fetch_all(&pool)
        .await?;

        tracing::info!("Purging {} active garderies", garderies.len());

        for slug in garderies {
            if let Err(e) =
                minispace_api::services::cron::CronService::purge_expired_data(&pool, &slug).await
            {
                tracing::error!("Error purging tenant {}: {}", slug, e);
            }
        }

        tracing::info!("Data purge job completed for all garderies");
    }

    Ok(())
}
