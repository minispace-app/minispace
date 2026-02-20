use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
    models::message::{
        ConversationItem, CreateMessageRequest, Message, MessageWithSender, SendToParentsRequest,
        SendToParentsScope,
    },
};

/// Explicit column list for Message — casts message_type enum to TEXT.
const MSG_COLS: &str =
    "id, sender_id, message_type::TEXT as message_type, group_id, recipient_id,
     content, is_read, created_at, updated_at";

pub struct MessageService;

impl MessageService {
    pub async fn create_message(
        pool: &PgPool,
        tenant: &str,
        sender_id: Uuid,
        req: &CreateMessageRequest,
    ) -> anyhow::Result<MessageWithSender> {
        let schema = schema_name(tenant);

        let msg = sqlx::query_as::<_, MessageWithSender>(&format!(
            "WITH inserted AS (
                 INSERT INTO {schema}.messages (sender_id, message_type, group_id, recipient_id, content)
                 VALUES ($1, $2::\"{schema}\".message_type, $3, $4, $5)
                 RETURNING *
             )
             SELECT i.id, i.sender_id,
                 u.first_name AS sender_first_name, u.last_name AS sender_last_name,
                 i.message_type::TEXT AS message_type,
                 i.group_id, i.recipient_id, i.content, i.is_read, i.created_at
             FROM inserted i
             JOIN {schema}.users u ON u.id = i.sender_id"
        ))
        .bind(sender_id)
        .bind(req.message_type.to_string())
        .bind(req.group_id)
        .bind(req.recipient_id)
        .bind(&req.content)
        .fetch_one(pool)
        .await?;

        Ok(msg)
    }

    pub async fn list_messages(
        pool: &PgPool,
        tenant: &str,
        user_id: Uuid,
        offset: i64,
        per_page: i64,
    ) -> anyhow::Result<Vec<Message>> {
        let schema = schema_name(tenant);

        let group_ids: Vec<Uuid> = sqlx::query_scalar(&format!(
            "SELECT DISTINCT c.group_id
             FROM {schema}.child_parents cp
             JOIN {schema}.children c ON c.id = cp.child_id
             WHERE cp.user_id = $1 AND c.group_id IS NOT NULL"
        ))
        .bind(user_id)
        .fetch_all(pool)
        .await?;

        let msgs = sqlx::query_as::<_, Message>(&format!(
            "SELECT {MSG_COLS} FROM {schema}.messages
             WHERE message_type::text = 'broadcast'
                OR (message_type::text = 'group' AND group_id = ANY($1))
                OR (message_type::text = 'individual' AND (sender_id = $2 OR recipient_id = $2))
             ORDER BY created_at DESC
             LIMIT $3 OFFSET $4"
        ))
        .bind(&group_ids)
        .bind(user_id)
        .bind(per_page)
        .bind(offset)
        .fetch_all(pool)
        .await?;

        Ok(msgs)
    }

    pub async fn mark_read(
        pool: &PgPool,
        tenant: &str,
        message_id: Uuid,
        user_id: Uuid,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);
        sqlx::query(&format!(
            "UPDATE {schema}.messages SET is_read = TRUE
             WHERE id = $1 AND (recipient_id = $2 OR message_type::text != 'individual')"
        ))
        .bind(message_id)
        .bind(user_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Mark all unread messages in a thread as read for the current user.
    /// - broadcast/group: marks messages not sent by the user
    /// - individual: marks messages sent by the other party
    pub async fn mark_thread_read(
        pool: &PgPool,
        tenant: &str,
        user_id: Uuid,
        kind: &str,
        thread_id: Option<Uuid>,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);
        match kind {
            "broadcast" => {
                sqlx::query(&format!(
                    "UPDATE {schema}.messages SET is_read = TRUE
                     WHERE message_type::text = 'broadcast'
                       AND is_read = FALSE AND sender_id != $1"
                ))
                .bind(user_id)
                .execute(pool)
                .await?;
            }
            "group" => {
                if let Some(gid) = thread_id {
                    sqlx::query(&format!(
                        "UPDATE {schema}.messages SET is_read = TRUE
                         WHERE message_type::text = 'group' AND group_id = $1
                           AND is_read = FALSE AND sender_id != $2"
                    ))
                    .bind(gid)
                    .bind(user_id)
                    .execute(pool)
                    .await?;
                }
            }
            "individual" => {
                if let Some(other_id) = thread_id {
                    // Mark messages sent by the other party as read
                    sqlx::query(&format!(
                        "UPDATE {schema}.messages SET is_read = TRUE
                         WHERE message_type::text = 'individual'
                           AND sender_id = $1 AND is_read = FALSE
                           AND (recipient_id = $2 OR recipient_id IS NULL)"
                    ))
                    .bind(other_id)
                    .bind(user_id)
                    .execute(pool)
                    .await?;
                }
            }
            _ => {}
        }
        Ok(())
    }

    pub async fn get_conversation(
        pool: &PgPool,
        tenant: &str,
        user_a: Uuid,
        user_b: Uuid,
        offset: i64,
        per_page: i64,
    ) -> anyhow::Result<Vec<Message>> {
        let schema = schema_name(tenant);
        let msgs = sqlx::query_as::<_, Message>(&format!(
            "SELECT {MSG_COLS} FROM {schema}.messages
             WHERE message_type::text = 'individual'
               AND ((sender_id = $1 AND recipient_id = $2)
                 OR (sender_id = $2 AND recipient_id = $1))
             ORDER BY created_at DESC
             LIMIT $3 OFFSET $4"
        ))
        .bind(user_a)
        .bind(user_b)
        .bind(per_page)
        .bind(offset)
        .fetch_all(pool)
        .await?;
        Ok(msgs)
    }

    /// GET /messages/conversations — liste des fils de discussion pour l'admin
    pub async fn get_conversations_admin(
        pool: &PgPool,
        tenant: &str,
    ) -> anyhow::Result<Vec<ConversationItem>> {
        let schema = schema_name(tenant);
        let mut items = Vec::new();

        // 1. Item broadcast (toujours présent)
        let broadcast_last: Option<(String, chrono::DateTime<chrono::Utc>)> =
            sqlx::query_as(&format!(
                "SELECT content, created_at FROM {schema}.messages
                 WHERE message_type::text = 'broadcast'
                 ORDER BY created_at DESC LIMIT 1"
            ))
            .fetch_optional(pool)
            .await?;

        let (last_msg, last_at) = match broadcast_last {
            Some((c, a)) => (Some(c), Some(a)),
            None => (None, None),
        };
        items.push(ConversationItem {
            kind: "broadcast".to_string(),
            id: None,
            name: "Tous les parents".to_string(),
            color: None,
            last_message: last_msg,
            last_at,
            unread_count: 0,
        });

        // 2. Tous les groupes avec dernier message
        let groups: Vec<(Uuid, String, Option<String>, Option<String>, Option<chrono::DateTime<chrono::Utc>>)> =
            sqlx::query_as(&format!(
                "SELECT g.id, g.name, g.color,
                   (SELECT m.content FROM {schema}.messages m
                    WHERE m.message_type::text = 'group' AND m.group_id = g.id
                    ORDER BY m.created_at DESC LIMIT 1) AS last_message,
                   (SELECT m.created_at FROM {schema}.messages m
                    WHERE m.message_type::text = 'group' AND m.group_id = g.id
                    ORDER BY m.created_at DESC LIMIT 1) AS last_at
                 FROM {schema}.groups g
                 ORDER BY g.name"
            ))
            .fetch_all(pool)
            .await?;

        for (id, name, color, last_msg, last_at) in groups {
            items.push(ConversationItem {
                kind: "group".to_string(),
                id: Some(id.to_string()),
                name,
                color,
                last_message: last_msg,
                last_at,
                unread_count: 0,
            });
        }

        // 3. Parents ayant un fil individuel
        let parents: Vec<(Uuid, String, String, Option<String>, Option<chrono::DateTime<chrono::Utc>>, i64)> =
            sqlx::query_as(&format!(
                "SELECT u.id, u.first_name, u.last_name,
                   (SELECT m.content FROM {schema}.messages m
                    WHERE m.message_type::text = 'individual'
                      AND (m.sender_id = u.id OR m.recipient_id = u.id)
                    ORDER BY m.created_at DESC LIMIT 1) AS last_message,
                   (SELECT m.created_at FROM {schema}.messages m
                    WHERE m.message_type::text = 'individual'
                      AND (m.sender_id = u.id OR m.recipient_id = u.id)
                    ORDER BY m.created_at DESC LIMIT 1) AS last_at,
                   (SELECT COUNT(*) FROM {schema}.messages m
                    WHERE m.message_type::text = 'individual'
                      AND m.sender_id = u.id AND m.is_read = FALSE) AS unread_count
                 FROM {schema}.users u
                 WHERE u.role::text = 'parent' AND u.is_active = TRUE
                   AND EXISTS (
                     SELECT 1 FROM {schema}.messages mm
                     WHERE mm.message_type::text = 'individual'
                       AND (mm.sender_id = u.id OR mm.recipient_id = u.id)
                   )
                 ORDER BY last_at DESC NULLS LAST"
            ))
            .fetch_all(pool)
            .await?;

        for (id, first, last, last_msg, last_at, unread) in parents {
            items.push(ConversationItem {
                kind: "individual".to_string(),
                id: Some(id.to_string()),
                name: format!("{first} {last}"),
                color: None,
                last_message: last_msg,
                last_at,
                unread_count: unread,
            });
        }

        Ok(items)
    }

    /// GET /messages/conversations — liste des fils pour un parent
    pub async fn get_conversations_parent(
        pool: &PgPool,
        tenant: &str,
        user_id: Uuid,
    ) -> anyhow::Result<Vec<ConversationItem>> {
        let schema = schema_name(tenant);
        let mut items = Vec::new();

        // 1. Item broadcast (lecture seule)
        let broadcast_last: Option<(String, chrono::DateTime<chrono::Utc>)> =
            sqlx::query_as(&format!(
                "SELECT content, created_at FROM {schema}.messages
                 WHERE message_type::text = 'broadcast'
                 ORDER BY created_at DESC LIMIT 1"
            ))
            .fetch_optional(pool)
            .await?;

        let (last_msg, last_at) = match broadcast_last {
            Some((c, a)) => (Some(c), Some(a)),
            None => (None, None),
        };
        items.push(ConversationItem {
            kind: "broadcast".to_string(),
            id: None,
            name: "Tous les parents".to_string(),
            color: None,
            last_message: last_msg,
            last_at,
            unread_count: 0,
        });

        // 2. Groupes des enfants du parent
        let groups: Vec<(Uuid, String, Option<String>, Option<String>, Option<chrono::DateTime<chrono::Utc>>)> =
            sqlx::query_as(&format!(
                "SELECT DISTINCT g.id, g.name, g.color,
                   (SELECT m.content FROM {schema}.messages m
                    WHERE m.message_type::text = 'group' AND m.group_id = g.id
                    ORDER BY m.created_at DESC LIMIT 1) AS last_message,
                   (SELECT m.created_at FROM {schema}.messages m
                    WHERE m.message_type::text = 'group' AND m.group_id = g.id
                    ORDER BY m.created_at DESC LIMIT 1) AS last_at
                 FROM {schema}.groups g
                 JOIN {schema}.children c ON c.group_id = g.id
                 JOIN {schema}.child_parents cp ON cp.child_id = c.id
                 WHERE cp.user_id = $1
                 ORDER BY g.name"
            ))
            .bind(user_id)
            .fetch_all(pool)
            .await?;

        for (id, name, color, last_msg, last_at) in groups {
            items.push(ConversationItem {
                kind: "group".to_string(),
                id: Some(id.to_string()),
                name,
                color,
                last_message: last_msg,
                last_at,
                unread_count: 0,
            });
        }

        // 3. Fil individuel "Garderie"
        let last_msg: Option<String> = sqlx::query_scalar(&format!(
            "SELECT content FROM {schema}.messages
             WHERE message_type::text = 'individual'
               AND (sender_id = $1 OR recipient_id = $1)
             ORDER BY created_at DESC LIMIT 1"
        ))
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

        let last_at: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(&format!(
            "SELECT created_at FROM {schema}.messages
             WHERE message_type::text = 'individual'
               AND (sender_id = $1 OR recipient_id = $1)
             ORDER BY created_at DESC LIMIT 1"
        ))
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

        let unread: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM {schema}.messages
             WHERE message_type::text = 'individual'
               AND recipient_id = $1 AND is_read = FALSE"
        ))
        .bind(user_id)
        .fetch_one(pool)
        .await?;
        items.push(ConversationItem {
            kind: "individual".to_string(),
            id: Some(user_id.to_string()),
            name: "Garderie".to_string(),
            color: None,
            last_message: last_msg,
            last_at,
            unread_count: unread,
        });

        Ok(items)
    }

    /// GET /messages/thread/broadcast
    pub async fn get_broadcast_thread(
        pool: &PgPool,
        tenant: &str,
        per_page: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<MessageWithSender>> {
        let schema = schema_name(tenant);
        let msgs = sqlx::query_as::<_, MessageWithSender>(&format!(
            "SELECT m.id, m.sender_id,
                 u.first_name AS sender_first_name, u.last_name AS sender_last_name,
                 m.message_type::TEXT AS message_type,
                 m.group_id, m.recipient_id, m.content, m.is_read, m.created_at
             FROM {schema}.messages m
             JOIN {schema}.users u ON u.id = m.sender_id
             WHERE m.message_type::text = 'broadcast'
             ORDER BY m.created_at ASC
             LIMIT $1 OFFSET $2"
        ))
        .bind(per_page)
        .bind(offset)
        .fetch_all(pool)
        .await?;
        Ok(msgs)
    }

    /// GET /messages/thread/group/:group_id
    pub async fn get_group_thread(
        pool: &PgPool,
        tenant: &str,
        group_id: Uuid,
        per_page: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<MessageWithSender>> {
        let schema = schema_name(tenant);
        let msgs = sqlx::query_as::<_, MessageWithSender>(&format!(
            "SELECT m.id, m.sender_id,
                 u.first_name AS sender_first_name, u.last_name AS sender_last_name,
                 m.message_type::TEXT AS message_type,
                 m.group_id, m.recipient_id, m.content, m.is_read, m.created_at
             FROM {schema}.messages m
             JOIN {schema}.users u ON u.id = m.sender_id
             WHERE m.message_type::text = 'group' AND m.group_id = $1
             ORDER BY m.created_at ASC
             LIMIT $2 OFFSET $3"
        ))
        .bind(group_id)
        .bind(per_page)
        .bind(offset)
        .fetch_all(pool)
        .await?;
        Ok(msgs)
    }

    /// GET /messages/thread/individual/:parent_id
    pub async fn get_individual_thread(
        pool: &PgPool,
        tenant: &str,
        parent_id: Uuid,
        per_page: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<MessageWithSender>> {
        let schema = schema_name(tenant);
        let msgs = sqlx::query_as::<_, MessageWithSender>(&format!(
            "SELECT m.id, m.sender_id,
                 u.first_name AS sender_first_name, u.last_name AS sender_last_name,
                 m.message_type::TEXT AS message_type,
                 m.group_id, m.recipient_id, m.content, m.is_read, m.created_at
             FROM {schema}.messages m
             JOIN {schema}.users u ON u.id = m.sender_id
             WHERE m.message_type::text = 'individual'
               AND (m.sender_id = $1 OR m.recipient_id = $1)
             ORDER BY m.created_at ASC
             LIMIT $2 OFFSET $3"
        ))
        .bind(parent_id)
        .bind(per_page)
        .bind(offset)
        .fetch_all(pool)
        .await?;
        Ok(msgs)
    }

    /// Envoyer un message à des parents avec notification email automatique.
    /// Retourne les adresses email des parents et crée l'enregistrement du message.
    pub async fn send_to_parents(
        pool: &PgPool,
        tenant: &str,
        sender_id: Uuid,
        req: &SendToParentsRequest,
    ) -> anyhow::Result<(Message, Vec<(String, String)>)> {
        let schema = schema_name(tenant);

        // Récupérer la liste des parents selon le scope
        let recipients: Vec<(String, String)> = match req.scope {
            SendToParentsScope::AllParents => {
                sqlx::query_as(&format!(
                    "SELECT u.email, CONCAT(u.first_name, ' ', u.last_name)
                     FROM {schema}.users u
                     WHERE u.role = 'parent' AND u.is_active = TRUE
                     ORDER BY u.first_name, u.last_name"
                ))
                .fetch_all(pool)
                .await?
            }
            SendToParentsScope::ChildParents => {
                let child_id = req.child_id.ok_or_else(|| anyhow::anyhow!("child_id required for ChildParents scope"))?;
                sqlx::query_as(&format!(
                    "SELECT u.email, CONCAT(u.first_name, ' ', u.last_name)
                     FROM {schema}.users u
                     INNER JOIN {schema}.child_parents cp ON u.id = cp.user_id
                     WHERE cp.child_id = $1 AND u.is_active = TRUE
                     ORDER BY u.first_name, u.last_name"
                ))
                .bind(child_id)
                .fetch_all(pool)
                .await?
            }
            SendToParentsScope::GroupParents => {
                let group_id = req.group_id.ok_or_else(|| anyhow::anyhow!("group_id required for GroupParents scope"))?;
                sqlx::query_as(&format!(
                    "SELECT DISTINCT u.email, CONCAT(u.first_name, ' ', u.last_name)
                     FROM {schema}.users u
                     INNER JOIN {schema}.child_parents cp ON u.id = cp.user_id
                     INNER JOIN {schema}.children c ON c.id = cp.child_id
                     WHERE c.group_id = $1 AND u.is_active = TRUE
                     ORDER BY u.first_name, u.last_name"
                ))
                .bind(group_id)
                .fetch_all(pool)
                .await?
            }
        };

        if recipients.is_empty() {
            anyhow::bail!("Aucun parent trouvé pour ce scope");
        }

        // Créer l'enregistrement du message avec le scope
        let msg = sqlx::query_as::<_, Message>(&format!(
            "INSERT INTO {schema}.messages
             (sender_id, message_type, subject, send_to_parents_scope, send_to_parents_child, send_to_parents_group, content, email_sent)
             VALUES ($1, 'broadcast'::\"{schema}\".message_type, $2, $3::\"{schema}\".send_to_parents_scope, $4, $5, $6, FALSE)
             RETURNING {MSG_COLS}"
        ))
        .bind(sender_id)
        .bind(&req.subject)
        .bind(req.scope.to_string())
        .bind(req.child_id)
        .bind(req.group_id)
        .bind(&req.content)
        .fetch_one(pool)
        .await?;

        Ok((msg, recipients))
    }
}
