use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// One day's garderie-level menu entry (split into 3 sections).
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DailyMenu {
    pub id: Uuid,
    pub date: NaiveDate,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub menu: Option<String>, // Deprecated, kept for backwards compatibility
    pub collation_matin: Option<String>,
    pub diner: Option<String>,
    pub collation_apres_midi: Option<String>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Body for PUT /menus (create or update menu for a specific date).
#[derive(Debug, Deserialize)]
pub struct UpsertMenuRequest {
    pub date: NaiveDate,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub menu: Option<String>, // Deprecated
    pub collation_matin: Option<String>,
    pub diner: Option<String>,
    pub collation_apres_midi: Option<String>,
}

/// Query params for GET /menus.
#[derive(Debug, Deserialize)]
pub struct MenuWeekQuery {
    /// Monday of the desired week (ISO 8601 date, e.g. "2025-06-02").
    pub week_start: NaiveDate,
}
