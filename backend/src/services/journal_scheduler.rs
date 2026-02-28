use chrono::{Datelike, Local, Timelike};
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{info, warn};

use crate::services::email::EmailService;
use crate::services::journal::JournalService;

/// Spawn a background task that wakes up every minute and sends journals
/// for any tenant whose `journal_auto_send_time` matches the current local time.
/// Weekends are skipped automatically.
pub fn start(pool: PgPool, email: Option<Arc<EmailService>>) {
    tokio::spawn(async move {
        loop {
            // Sleep until the next minute boundary
            let secs_past = Local::now().second() as u64;
            let sleep_secs = if secs_past == 0 { 60 } else { 60 - secs_past };
            tokio::time::sleep(tokio::time::Duration::from_secs(sleep_secs)).await;

            let now = Local::now();
            let weekday = now.weekday();

            // Skip Saturday and Sunday
            if weekday == chrono::Weekday::Sat || weekday == chrono::Weekday::Sun {
                continue;
            }

            let current_time = format!("{:02}:{:02}", now.hour(), now.minute());
            let today = now.date_naive();

            // Fetch active tenants and their configured send time (skip demo)
            let tenants: Vec<(String, String)> = match sqlx::query_as(
                "SELECT slug, journal_auto_send_time FROM public.garderies WHERE is_active = TRUE AND slug != 'demo'",
            )
            .fetch_all(&pool)
            .await
            {
                Ok(rows) => rows,
                Err(e) => {
                    warn!("Journal scheduler: failed to query tenants: {}", e);
                    continue;
                }
            };

            for (slug, send_time) in tenants {
                if send_time == current_time {
                    info!("Journal auto-send: firing for tenant '{}'", slug);
                    match JournalService::auto_send_today(
                        &pool,
                        email.as_deref(),
                        &slug,
                        today,
                    )
                    .await
                    {
                        Ok(n) => info!("Journal auto-send: {} email(s) sent for '{}'", n, slug),
                        Err(e) => warn!("Journal auto-send error for '{}': {}", slug, e),
                    }
                }
            }
        }
    });
}
