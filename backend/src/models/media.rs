use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MediaType {
    Photo,
    Video,
}

impl std::fmt::Display for MediaType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", match self { MediaType::Photo => "photo", MediaType::Video => "video" })
    }
}

impl std::str::FromStr for MediaType {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "photo" => Ok(MediaType::Photo),
            "video" => Ok(MediaType::Video),
            _ => Err(anyhow::anyhow!("Unknown media_type: {s}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Media {
    pub id: Uuid,
    pub uploader_id: Uuid,
    pub media_type: String,
    pub original_filename: String,
    pub storage_path: String,
    pub thumbnail_path: Option<String>,
    pub content_type: String,
    pub size_bytes: i64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub duration_secs: Option<f64>,
    pub group_id: Option<Uuid>,
    pub child_id: Option<Uuid>,
    pub caption: Option<String>,
    pub visibility: String,
    pub child_ids: Vec<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct MediaQuery {
    pub group_id: Option<Uuid>,
    /// Comma-separated UUIDs "uuid1,uuid2"
    pub child_ids: Option<String>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
    /// "day" | "week" | "month"
    pub period: Option<String>,
    /// Reference date "YYYY-MM-DD" (defaults to today)
    pub date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMediaRequest {
    pub caption: Option<String>,
    /// "private" | "public" | "group" | "child"
    pub visibility: String,
    pub group_id: Option<Uuid>,
    pub child_ids: Option<Vec<Uuid>>,
}

#[derive(Debug, Deserialize)]
pub struct BulkMediaRequest {
    /// "delete" | "assign"
    pub action: String,
    pub media_ids: Vec<Uuid>,
    /// For "assign" action
    pub visibility: Option<String>,
    pub group_id: Option<Uuid>,
    pub child_ids: Option<Vec<Uuid>>,
}
