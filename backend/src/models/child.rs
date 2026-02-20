use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Child {
    pub id: Uuid,
    pub first_name: String,
    pub last_name: String,
    pub birth_date: NaiveDate,
    pub photo_url: Option<String>,
    pub group_id: Option<Uuid>,
    pub notes: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ChildParent {
    pub child_id: Uuid,
    pub user_id: Uuid,
    pub relationship: String, // "parent", "guardian", etc.
}

#[derive(Debug, Deserialize)]
pub struct CreateChildRequest {
    pub first_name: String,
    pub last_name: String,
    pub birth_date: NaiveDate,
    pub group_id: Option<Uuid>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateChildRequest {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub birth_date: Option<NaiveDate>,
    pub group_id: Option<Uuid>,
    pub notes: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct AssignParentRequest {
    pub user_id: Uuid,
    pub relationship: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ChildParentUser {
    pub user_id: Uuid,
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub relationship: String,
}
