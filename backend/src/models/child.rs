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
    pub start_date: Option<NaiveDate>,
    pub schedule_days: Option<Vec<i32>>,
    #[serde(skip_serializing)]
    pub avatar_iv: Option<Vec<u8>>,
    #[serde(skip_serializing)]
    pub avatar_tag: Option<Vec<u8>>,
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
    pub start_date: Option<NaiveDate>,
    pub schedule_days: Option<Vec<i32>>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateChildRequest {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub birth_date: Option<NaiveDate>,
    pub group_id: Option<Uuid>,
    pub notes: Option<String>,
    pub is_active: Option<bool>,
    pub start_date: Option<NaiveDate>,
    pub schedule_days: Option<Vec<i32>>,
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

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PendingParent {
    pub child_id: Uuid,
    pub email: String,
    pub relationship: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct AssignPendingParentRequest {
    pub email: String,
    pub relationship: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct InvitedParent {
    pub email: String,
    pub role: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct AssignInvitedParentRequest {
    pub email: String,
    pub role: String,
}

#[derive(Debug, Serialize)]
pub struct ImportRowError {
    pub row: usize,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub created_groups: usize,
    pub created_children: usize,
    pub added_pending_parents: usize,
    pub invited_parents: usize,
    pub skipped_rows: Vec<ImportRowError>,
}
