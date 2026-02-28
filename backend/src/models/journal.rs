use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Valid values for the temperature field.
pub const WEATHER_CONDITIONS: &[&str] =
    &["ensoleille", "nuageux", "pluie", "neige", "orageux"];

/// Valid values for the appetit field.
pub const APPETIT_LEVELS: &[&str] =
    &["comme_habitude", "peu", "beaucoup", "refuse"];

/// Valid values for the humeur field.
pub const HUMEUR_LEVELS: &[&str] =
    &["tres_bien", "bien", "difficile", "pleurs"];

/// One day's journal entry for a child.
/// Enum columns are cast to TEXT in SQL so sqlx maps them as Option<String>.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DailyJournal {
    pub id: Uuid,
    pub child_id: Uuid,
    pub date: NaiveDate,
    pub temperature: Option<String>,
    pub menu: Option<String>,
    pub appetit: Option<String>,
    pub humeur: Option<String>,
    pub sommeil_minutes: Option<i16>,
    pub absent: bool,
    pub sante: Option<String>,
    pub medicaments: Option<String>,
    pub message_educatrice: Option<String>,
    pub observations: Option<String>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Body for PUT /journals (create or update a single day).
#[derive(Debug, Deserialize)]
pub struct UpsertJournalRequest {
    pub child_id: Uuid,
    pub date: NaiveDate,
    pub temperature: Option<String>,
    pub menu: Option<String>,
    pub appetit: Option<String>,
    pub humeur: Option<String>,
    pub sommeil_minutes: Option<i16>,
    #[serde(default)]
    pub absent: bool,
    pub sante: Option<String>,
    pub medicaments: Option<String>,
    pub message_educatrice: Option<String>,
    pub observations: Option<String>,
}

/// Query params for GET /journals.
#[derive(Debug, Deserialize)]
pub struct JournalWeekQuery {
    pub child_id: Uuid,
    /// Monday of the desired week (ISO 8601 date, e.g. "2025-06-02").
    pub week_start: NaiveDate,
}
