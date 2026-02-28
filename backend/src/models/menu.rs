use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// One day's garderie-level menu entry.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DailyMenu {
    pub id: Uuid,
    pub date: NaiveDate,
    pub menu: String,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Body for PUT /menus (create or update menu for a specific date).
#[derive(Debug, Deserialize)]
pub struct UpsertMenuRequest {
    pub date: NaiveDate,
    pub menu: String,
}

/// Query params for GET /menus.
#[derive(Debug, Deserialize)]
pub struct MenuWeekQuery {
    /// Monday of the desired week (ISO 8601 date, e.g. "2025-06-02").
    pub week_start: NaiveDate,
}
