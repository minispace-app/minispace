use axum::{http::StatusCode, Json};
use serde_json::json;

/// Checks an email-keyed rate limit stored in Redis.
///
/// Uses the INCR + EXPIRE strategy:
/// - Increments a counter for `key`
/// - On first increment, sets TTL to `window_secs`
/// - Returns 429 if counter exceeds `max_attempts`
pub async fn check_rate_limit(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    max_attempts: u64,
    window_secs: u64,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let count: u64 = redis::cmd("INCR")
        .arg(key)
        .query_async(redis)
        .await
        .unwrap_or(0);

    if count == 1 {
        // Set TTL only on first increment to avoid resetting the window on each attempt
        let _: Result<(), _> = redis::cmd("EXPIRE")
            .arg(key)
            .arg(window_secs)
            .query_async(redis)
            .await;
    }

    if count > max_attempts {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "error": "Trop de tentatives. Réessayez dans quelques minutes." })),
        ));
    }

    Ok(())
}
