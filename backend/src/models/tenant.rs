use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "plan_type", rename_all = "snake_case")]
#[serde(rename_all = "lowercase")]
pub enum PlanType {
    Free,
    Standard,
    Premium,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Garderie {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub logo_url: Option<String>,
    pub plan: PlanType,
    pub is_active: bool,
    pub trial_expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateGarderieRequest {
    pub slug: String,
    pub name: String,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub plan: Option<PlanType>,
}

#[derive(Debug, Deserialize)]
pub struct SignupRequest {
    pub slug: String,
    pub name: String,
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub password: String,
}
