use reqwest::Client;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::tenant::schema_name;

pub struct NotificationService {
    pub client: Client,
    pub fcm_api_key: Option<String>,
}

impl NotificationService {
    pub fn new(fcm_api_key: Option<String>) -> Self {
        Self {
            client: Client::new(),
            fcm_api_key,
        }
    }

    /// Send a push notification to a specific user's registered devices.
    pub async fn notify_user(
        &self,
        pool: &PgPool,
        tenant: &str,
        user_id: Uuid,
        title: &str,
        body: &str,
        data: Option<serde_json::Value>,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);
        let tokens: Vec<(String, String)> = sqlx::query_as(&format!(
            "SELECT platform, token FROM {schema}.push_tokens WHERE user_id = $1"
        ))
        .bind(user_id)
        .fetch_all(pool)
        .await?;

        for (platform, token) in tokens {
            match platform.as_str() {
                "android" => {
                    self.send_fcm(&token, title, body, data.clone()).await?;
                }
                "ios" => {
                    // APNS — send via FCM for simplicity, or implement direct APNS
                    self.send_fcm(&token, title, body, data.clone()).await?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// Broadcast notification to all parents in a tenant.
    pub async fn notify_all_parents(
        &self,
        pool: &PgPool,
        tenant: &str,
        title: &str,
        body: &str,
        data: Option<serde_json::Value>,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);
        let tokens: Vec<(String, String)> = sqlx::query_as(&format!(
            "SELECT pt.platform, pt.token
             FROM {schema}.push_tokens pt
             JOIN {schema}.users u ON u.id = pt.user_id
             WHERE u.role = 'parent' AND u.is_active = TRUE"
        ))
        .fetch_all(pool)
        .await?;

        for (_, token) in tokens {
            let _ = self.send_fcm(&token, title, body, data.clone()).await;
        }
        Ok(())
    }

    async fn send_fcm(
        &self,
        token: &str,
        title: &str,
        body: &str,
        data: Option<serde_json::Value>,
    ) -> anyhow::Result<()> {
        let api_key = match &self.fcm_api_key {
            Some(k) => k,
            None => {
                tracing::debug!("FCM not configured, skipping push notification");
                return Ok(());
            }
        };

        let mut payload = json!({
            "to": token,
            "notification": {
                "title": title,
                "body": body,
            }
        });

        if let Some(d) = data {
            payload["data"] = d;
        }

        let response = self
            .client
            .post("https://fcm.googleapis.com/fcm/send")
            .header("Authorization", format!("key={}", api_key))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            tracing::warn!("FCM error {}: {}", status, text);
        }

        Ok(())
    }

    pub async fn register_push_token(
        pool: &PgPool,
        tenant: &str,
        user_id: Uuid,
        platform: &str,
        token: &str,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);
        sqlx::query(&format!(
            "INSERT INTO {schema}.push_tokens (user_id, platform, token)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, token) DO NOTHING"
        ))
        .bind(user_id)
        .bind(platform)
        .bind(token)
        .execute(pool)
        .await?;
        Ok(())
    }
}
