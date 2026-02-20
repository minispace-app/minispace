use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MessageType {
    Broadcast,
    Group,
    Individual,
}

impl std::fmt::Display for MessageType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            MessageType::Broadcast => "broadcast",
            MessageType::Group => "group",
            MessageType::Individual => "individual",
        };
        write!(f, "{s}")
    }
}

impl std::str::FromStr for MessageType {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "broadcast" => Ok(MessageType::Broadcast),
            "group" => Ok(MessageType::Group),
            "individual" => Ok(MessageType::Individual),
            _ => Err(anyhow::anyhow!("Unknown message_type: {s}")),
        }
    }
}

/// Scope pour envoyer un message à des parents avec email automatique
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SendToParentsScope {
    AllParents,           // À tous les parents du tenant
    ChildParents,         // À tous les parents d'un enfant
    GroupParents,         // À tous les parents d'un groupe
}

impl std::fmt::Display for SendToParentsScope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            SendToParentsScope::AllParents => "all_parents",
            SendToParentsScope::ChildParents => "child_parents",
            SendToParentsScope::GroupParents => "group_parents",
        };
        write!(f, "{s}")
    }
}

impl std::str::FromStr for SendToParentsScope {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "all_parents" => Ok(SendToParentsScope::AllParents),
            "child_parents" => Ok(SendToParentsScope::ChildParents),
            "group_parents" => Ok(SendToParentsScope::GroupParents),
            _ => Err(anyhow::anyhow!("Unknown send_to_parents_scope: {s}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Message {
    pub id: Uuid,
    pub sender_id: Uuid,
    pub message_type: String,
    pub group_id: Option<Uuid>,
    pub recipient_id: Option<Uuid>,
    pub content: String,
    pub is_read: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MessageAttachment {
    pub id: Uuid,
    pub message_id: Uuid,
    pub media_id: Option<Uuid>,
    pub document_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct CreateMessageRequest {
    pub message_type: MessageType,
    pub group_id: Option<Uuid>,
    pub recipient_id: Option<Uuid>,
    pub content: String,
}

/// Request pour envoyer un message à des parents avec notification email
#[derive(Debug, Deserialize)]
pub struct SendToParentsRequest {
    pub subject: String,
    pub content: String,
    pub scope: SendToParentsScope,
    pub child_id: Option<Uuid>,    // Required si scope = ChildParents
    pub group_id: Option<Uuid>,    // Required si scope = GroupParents
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MessageWithSender {
    pub id: Uuid,
    pub sender_id: Uuid,
    pub sender_first_name: String,
    pub sender_last_name: String,
    pub message_type: String,
    pub group_id: Option<Uuid>,
    pub recipient_id: Option<Uuid>,
    pub content: String,
    pub is_read: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationItem {
    pub kind: String,
    pub id: Option<String>,
    pub name: String,
    pub color: Option<String>,
    pub last_message: Option<String>,
    pub last_at: Option<DateTime<Utc>>,
    pub unread_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsMessage {
    #[serde(rename = "type")]
    pub kind: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct PaginationQuery {
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

impl PaginationQuery {
    pub fn offset(&self) -> i64 {
        let page = self.page.unwrap_or(1).max(1);
        let per_page = self.per_page();
        (page - 1) * per_page
    }

    pub fn per_page(&self) -> i64 {
        self.per_page.unwrap_or(20).clamp(1, 100)
    }
}
