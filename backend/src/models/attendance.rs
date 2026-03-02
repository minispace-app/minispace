use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttendanceStatus {
    Attendu,
    Present,
    Absent,
    Malade,
    Vacances,
    PresentHorsContrat,
}

impl std::fmt::Display for AttendanceStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            AttendanceStatus::Attendu => "attendu",
            AttendanceStatus::Present => "present",
            AttendanceStatus::Absent => "absent",
            AttendanceStatus::Malade => "malade",
            AttendanceStatus::Vacances => "vacances",
            AttendanceStatus::PresentHorsContrat => "present_hors_contrat",
        };
        write!(f, "{s}")
    }
}

impl std::str::FromStr for AttendanceStatus {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "attendu" => Ok(AttendanceStatus::Attendu),
            "present" => Ok(AttendanceStatus::Present),
            "absent" => Ok(AttendanceStatus::Absent),
            "malade" => Ok(AttendanceStatus::Malade),
            "vacances" => Ok(AttendanceStatus::Vacances),
            "present_hors_contrat" => Ok(AttendanceStatus::PresentHorsContrat),
            _ => Err(anyhow::anyhow!("Unknown status: {s}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AttendanceRecord {
    pub id: Uuid,
    pub child_id: Uuid,
    pub date: NaiveDate,
    #[sqlx(rename = "status")]
    pub status: String, // Fetched as TEXT to avoid schema-qualified enum mismatch
    pub marked_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SetAttendanceRequest {
    pub child_id: Uuid,
    pub date: String, // YYYY-MM-DD
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct AttendanceMonthQuery {
    pub child_id: Uuid,
    pub month: String, // YYYY-MM
}

#[derive(Debug, Deserialize)]
pub struct AttendanceMonthAllQuery {
    pub month: String, // YYYY-MM
}
