use chrono::{Local, Timelike};
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{info, warn};

use crate::db::tenant::schema_name;
use crate::services::email::EmailService;

/// Jours avant expiration pour lesquels on envoie un rappel.
const WARN_DAYS: &[i64] = &[7, 3, 1];

/// Spawn a background task that wakes up daily at 9:00 AM and sends trial
/// expiry warnings to tenant admins and to contact@minispace.app.
/// Redis keys (TTL 2 days) prevent duplicate sends if the server restarts.
pub fn start(pool: PgPool, email: Option<Arc<EmailService>>, redis: redis::Client) {
    tokio::spawn(async move {
        loop {
            // Sleep until next 9:00 AM
            let now = Local::now();
            let target_hour = 9u32;
            let secs_until_9am = {
                let secs_today = now.hour() * 3600 + now.minute() * 60 + now.second();
                let target_secs = target_hour * 3600;
                if secs_today < target_secs {
                    (target_secs - secs_today) as u64
                } else {
                    // Already past 9 AM today → wait until tomorrow 9 AM
                    (86400 - secs_today + target_secs) as u64
                }
            };
            tokio::time::sleep(tokio::time::Duration::from_secs(secs_until_9am)).await;

            let Some(ref email_svc) = email else {
                continue;
            };

            let mut redis_conn = match redis.get_multiplexed_async_connection().await {
                Ok(c) => c,
                Err(e) => {
                    warn!("Trial scheduler: Redis unavailable: {e}");
                    continue;
                }
            };

            for days in WARN_DAYS {
                check_and_notify(&pool, email_svc, &mut redis_conn, *days).await;
            }
        }
    });
}

async fn check_and_notify(
    pool: &PgPool,
    email_svc: &EmailService,
    redis: &mut redis::aio::MultiplexedConnection,
    days: i64,
) {
    // Garderies whose trial expires in exactly `days` days
    let rows: Vec<(String, String, Option<String>)> = match sqlx::query_as(
        "SELECT slug, name, email
         FROM public.garderies
         WHERE is_active = TRUE
           AND slug != 'demo'
           AND trial_expires_at::date = (NOW() + $1 * INTERVAL '1 day')::date",
    )
    .bind(days)
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            warn!("Trial scheduler (J-{days}): DB query failed: {e}");
            return;
        }
    };

    for (slug, name, _garderie_email) in rows {
        // Redis dedup: skip if already notified for this window
        let redis_key = format!("trial:notif:{days}d:{slug}");
        let already: bool = redis::cmd("EXISTS")
            .arg(&redis_key)
            .query_async(redis)
            .await
            .unwrap_or(false);

        if already {
            continue;
        }

        // Mark as notified (TTL 2 days — covers restarts within the same day)
        let _: Result<(), _> = redis::cmd("SETEX")
            .arg(&redis_key)
            .arg(172_800u64) // 2 days
            .arg(1)
            .query_async(redis)
            .await;

        // Look up the first admin user of this tenant
        let schema = schema_name(&slug);
        let admin: Option<(String, String, String)> = sqlx::query_as(&format!(
            r#"SELECT email, first_name, last_name
               FROM "{schema}".users
               WHERE role = 'admin_garderie' AND is_active = TRUE
               ORDER BY created_at ASC
               LIMIT 1"#
        ))
        .fetch_optional(pool)
        .await
        .unwrap_or(None);

        let (admin_email, admin_first, admin_last) = match admin {
            Some(row) => row,
            None => {
                warn!("Trial scheduler (J-{days}): no active admin found for '{slug}'");
                continue;
            }
        };

        let admin_name = format!("{admin_first} {admin_last}");
        let login_url = format!("https://{slug}.minispace.app/fr/login");

        match email_svc
            .send_trial_expiry_warning(
                &admin_email,
                &admin_name,
                &slug,
                &name,
                days,
                &login_url,
            )
            .await
        {
            Ok(_) => info!(
                "Trial scheduler: expiry warning (J-{days}) sent for '{slug}' → {admin_email}"
            ),
            Err(e) => warn!(
                "Trial scheduler: failed to send J-{days} warning for '{slug}': {e}"
            ),
        }
    }
}
