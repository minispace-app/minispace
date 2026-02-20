use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DocCategory {
    Formulaire,
    Menu,
    Politique,
    Bulletin,
    Autre,
}

impl std::fmt::Display for DocCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            DocCategory::Formulaire => "formulaire",
            DocCategory::Menu => "menu",
            DocCategory::Politique => "politique",
            DocCategory::Bulletin => "bulletin",
            DocCategory::Autre => "autre",
        };
        write!(f, "{s}")
    }
}

impl std::str::FromStr for DocCategory {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "formulaire" => Ok(DocCategory::Formulaire),
            "menu" => Ok(DocCategory::Menu),
            "politique" => Ok(DocCategory::Politique),
            "bulletin" => Ok(DocCategory::Bulletin),
            "autre" => Ok(DocCategory::Autre),
            _ => Err(anyhow::anyhow!("Unknown doc_category: {s}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Document {
    pub id: Uuid,
    pub uploader_id: Uuid,
    pub title: String,
    pub category: String,
    pub original_filename: String,
    pub storage_path: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub group_id: Option<Uuid>,
    pub child_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct DocumentQuery {
    pub category: Option<String>,
    pub group_id: Option<Uuid>,
    pub child_id: Option<Uuid>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateDocumentRequest {
    pub title: String,
    pub category: String,
    /// "public" | "group" | "child"
    pub visibility: String,
    pub group_id: Option<Uuid>,
    pub child_id: Option<Uuid>,
}
