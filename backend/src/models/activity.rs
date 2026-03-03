use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Activity {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub date: NaiveDate,
    pub end_date: Option<NaiveDate>,
    pub capacity: Option<i32>,
    pub group_id: Option<Uuid>,
    #[sqlx(rename = "type")]
    #[serde(rename = "type")]
    pub activity_type: String,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[sqlx(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registration_count: Option<i32>,
    #[sqlx(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_registered: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ActivityRegistration {
    pub id: Uuid,
    pub activity_id: Uuid,
    pub child_id: Uuid,
    pub registered_by: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ActivityRegistrationWithChild {
    pub id: Uuid,
    pub child_id: Uuid,
    pub first_name: String,
    pub last_name: String,
    pub registered_by: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateActivityRequest {
    pub title: String,
    pub description: Option<String>,
    pub date: String, // YYYY-MM-DD
    pub end_date: Option<String>, // YYYY-MM-DD
    pub capacity: Option<i32>,
    pub group_id: Option<Uuid>,
    #[serde(rename = "type")]
    pub activity_type: Option<String>, // "theme" | "sortie", default "sortie"
}

#[derive(Debug, Deserialize)]
pub struct UpdateActivityRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub date: Option<String>, // YYYY-MM-DD
    pub end_date: Option<String>, // YYYY-MM-DD
    pub capacity: Option<i32>,
    pub group_id: Option<Uuid>,
    #[serde(rename = "type")]
    pub activity_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub child_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct ActivitiesListQuery {
    pub month: String, // YYYY-MM
    pub child_id: Option<Uuid>,
}
