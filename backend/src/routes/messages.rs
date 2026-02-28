use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use redis::AsyncCommands;
use serde_json::{json, Value};
use uuid::Uuid;

use serde::Deserialize;

use crate::{
    db::tenant::schema_name,
    middleware::tenant::TenantSlug,
    models::{
        auth::AuthenticatedUser,
        message::{CreateMessageRequest, MessageType, PaginationQuery, SendToParentsRequest},
        user::UserRole,
    },
    services::messages::MessageService,
    AppState,
};

#[derive(Deserialize)]
pub struct MarkThreadReadRequest {
    pub kind: String,
    pub id: Option<String>,
}

pub async fn list_messages(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Query(pagination): Query<PaginationQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    MessageService::list_messages(
        &state.db,
        &tenant,
        user.user_id,
        pagination.offset(),
        pagination.per_page(),
    )
    .await
    .map(|msgs| Json(serde_json::to_value(msgs).unwrap()))
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })
}

pub async fn send_message(
    State(mut state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Json(body): Json<CreateMessageRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    // Permission checks pour les parents
    if let UserRole::Parent = user.role {
        if let MessageType::Broadcast = body.message_type {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({ "error": "Les parents ne peuvent pas envoyer de diffusion générale" })),
            ));
        }
        if let MessageType::Group = body.message_type {
            if let Some(group_id) = body.group_id {
                let s = schema_name(&tenant);
                let belongs: bool = sqlx::query_scalar(&format!(
                    "SELECT EXISTS(
                         SELECT 1 FROM {s}.child_parents cp
                         JOIN {s}.children c ON c.id = cp.child_id
                         WHERE cp.user_id = $1 AND c.group_id = $2
                     )"
                ))
                .bind(user.user_id)
                .bind(group_id)
                .fetch_one(&state.db)
                .await
                .unwrap_or(false);

                if !belongs {
                    return Err((
                        StatusCode::FORBIDDEN,
                        Json(json!({ "error": "Accès refusé à ce groupe" })),
                    ));
                }
            }
        }
    }

    let msg = MessageService::create_message(&state.db, &tenant, user.user_id, &body)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })?;

    // Publish to Redis for real-time delivery
    let payload = serde_json::to_string(&msg).unwrap_or_default();
    let channel = format!("tenant:{}:messages", tenant);
    let _ = state.redis.publish::<_, _, ()>(&channel, &payload).await;

    // Email notifications asynchrones avec cooldown par fil (15 min)
    // Désactivé pour le tenant demo (adresses email fictives)
    if tenant != "demo" {
    if let Some(email_svc) = state.email.clone() {
        let pool = state.db.clone();
        let tenant_c = tenant.clone();
        let msg_clone = msg.clone();
        let base = &state.config.app_base_url;
        let app_url = if let Some(idx) = base.find("://") {
            let scheme = &base[..idx];
            let domain = &base[idx + 3..];
            format!("{scheme}://{tenant}.{domain}/fr/dashboard/messages")
        } else {
            format!("https://{tenant}.{base}/fr/dashboard/messages")
        };
        let sender_name = format!("{} {}", msg.sender_first_name, msg.sender_last_name);
        let mut redis = state.redis.clone();

        tokio::spawn(async move {
            let s = schema_name(&tenant_c);

            // Nom et logo de la garderie pour les emails
            let (garderie_name, logo_url): (String, Option<String>) = sqlx::query_as(
                "SELECT name, logo_url FROM public.garderies WHERE slug = $1"
            )
            .bind(&tenant_c)
            .fetch_optional(&pool)
            .await
            .unwrap_or_default()
            .unwrap_or_else(|| (tenant_c.clone(), None));
            let logo_url = logo_url.unwrap_or_default();

            // Clé cooldown unique par fil — empêche les doublons pendant 15 min
            let cooldown_key = match msg_clone.message_type.as_str() {
                "broadcast" => format!("notif_cooldown:{tenant_c}:broadcast"),
                "group" => match msg_clone.group_id {
                    Some(gid) => format!("notif_cooldown:{tenant_c}:group:{gid}"),
                    None => return,
                },
                "individual" => {
                    // thread identifié par l'ID du parent (recipient si admin→parent, sender si parent→admin)
                    let thread_id = msg_clone.recipient_id.unwrap_or(msg_clone.sender_id);
                    format!("notif_cooldown:{tenant_c}:individual:{thread_id}")
                }
                _ => return,
            };

            // SET NX EX : retourne "OK" si la clé est nouvellement posée, None si elle existait déjà
            let newly_set: Option<String> = redis::cmd("SET")
                .arg(&cooldown_key)
                .arg("1")
                .arg("NX")
                .arg("EX")
                .arg(900u64) // 15 minutes
                .query_async(&mut redis)
                .await
                .unwrap_or(None);

            if newly_set.is_none() {
                // Notification déjà envoyée récemment pour ce fil → on skip
                return;
            }

            match msg_clone.message_type.as_str() {
                "broadcast" => {
                    let recipients: Vec<(String, String)> = sqlx::query_as(&format!(
                        "SELECT email, CONCAT(first_name, ' ', last_name)
                         FROM {s}.users
                         WHERE role::text = 'parent' AND is_active = TRUE"
                    ))
                    .fetch_all(&pool)
                    .await
                    .unwrap_or_default();

                    for (email, name) in recipients {
                        let _ = email_svc
                            .send_message_notification(
                                &email,
                                &name,
                                &sender_name,
                                "Tous les parents",
                                &app_url,
                                &garderie_name,
                                &logo_url,
                            )
                            .await;
                    }
                }
                "group" => {
                    if let Some(group_id) = msg_clone.group_id {
                        let recipients: Vec<(String, String)> = sqlx::query_as(&format!(
                            "SELECT DISTINCT u.email, CONCAT(u.first_name, ' ', u.last_name)
                             FROM {s}.users u
                             JOIN {s}.child_parents cp ON cp.user_id = u.id
                             JOIN {s}.children c ON c.id = cp.child_id
                             WHERE c.group_id = $1 AND u.is_active = TRUE"
                        ))
                        .bind(group_id)
                        .fetch_all(&pool)
                        .await
                        .unwrap_or_default();

                        let group_name: String = sqlx::query_scalar(&format!(
                            "SELECT name FROM {s}.groups WHERE id = $1"
                        ))
                        .bind(group_id)
                        .fetch_optional(&pool)
                        .await
                        .unwrap_or_default()
                        .unwrap_or_else(|| "Groupe".to_string());

                        for (email, name) in recipients {
                            let _ = email_svc
                                .send_message_notification(
                                    &email,
                                    &name,
                                    &sender_name,
                                    &group_name,
                                    &app_url,
                                    &garderie_name,
                                    &logo_url,
                                )
                                .await;
                        }
                    }
                }
                "individual" => {
                    if let Some(recipient_id) = msg_clone.recipient_id {
                        // Admin → parent
                        let recipient: Option<(String, String)> = sqlx::query_as(&format!(
                            "SELECT email, CONCAT(first_name, ' ', last_name)
                             FROM {s}.users WHERE id = $1"
                        ))
                        .bind(recipient_id)
                        .fetch_optional(&pool)
                        .await
                        .unwrap_or_default();

                        if let Some((email, name)) = recipient {
                            let _ = email_svc
                                .send_message_notification(
                                    &email,
                                    &name,
                                    &sender_name,
                                    "Message privé",
                                    &app_url,
                                    &garderie_name,
                                    &logo_url,
                                )
                                .await;
                        }
                    } else {
                        // Parent → admin (recipient_id IS NULL)
                        let admins: Vec<(String, String)> = sqlx::query_as(&format!(
                            "SELECT email, CONCAT(first_name, ' ', last_name)
                             FROM {s}.users
                             WHERE role::text = 'admin_garderie' AND is_active = TRUE"
                        ))
                        .fetch_all(&pool)
                        .await
                        .unwrap_or_default();

                        for (email, name) in admins {
                            let _ = email_svc
                                .send_message_notification(
                                    &email,
                                    &name,
                                    &sender_name,
                                    "Message privé",
                                    &app_url,
                                    &garderie_name,
                                    &logo_url,
                                )
                                .await;
                        }
                    }
                }
                _ => {}
            }
        });
    }
    } // end if tenant != "demo"

    crate::services::metrics::MESSAGES_COUNTER.with_label_values(&[&tenant]).inc();
    Ok((
        StatusCode::CREATED,
        Json(serde_json::to_value(msg).unwrap()),
    ))
}

pub async fn mark_read(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(message_id): Path<Uuid>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    MessageService::mark_read(&state.db, &tenant, message_id, user.user_id)
        .await
        .map(|_| Json(json!({ "message": "Marked as read" })))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}

pub async fn mark_thread_read(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Json(body): Json<MarkThreadReadRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let thread_id = body.id.as_deref().and_then(|s| s.parse::<Uuid>().ok());
    MessageService::mark_thread_read(&state.db, &tenant, user.user_id, &body.kind, thread_id)
        .await
        .map(|_| Json(json!({ "message": "Thread marked as read" })))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}

pub async fn get_conversation(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Path(other_user_id): Path<Uuid>,
    Query(pagination): Query<PaginationQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    MessageService::get_conversation(
        &state.db,
        &tenant,
        user.user_id,
        other_user_id,
        pagination.offset(),
        pagination.per_page(),
    )
    .await
    .map(|msgs| Json(serde_json::to_value(msgs).unwrap()))
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })
}

/// GET /messages/conversations
pub async fn get_conversations(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = if matches!(user.role, UserRole::Parent) {
        MessageService::get_conversations_parent(&state.db, &tenant, user.user_id).await
    } else {
        MessageService::get_conversations_admin(&state.db, &tenant, user.user_id).await
    };

    result
        .map(|convs| Json(serde_json::to_value(convs).unwrap()))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            )
        })
}

/// GET /messages/thread/broadcast
pub async fn get_broadcast_thread(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    _user: AuthenticatedUser,
    Query(pagination): Query<PaginationQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    MessageService::get_broadcast_thread(
        &state.db,
        &tenant,
        pagination.per_page(),
        pagination.offset(),
    )
    .await
    .map(|msgs| Json(serde_json::to_value(msgs).unwrap()))
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })
}

/// GET /messages/thread/group/:group_id
pub async fn get_group_thread(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    _user: AuthenticatedUser,
    Path(group_id): Path<Uuid>,
    Query(pagination): Query<PaginationQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    MessageService::get_group_thread(
        &state.db,
        &tenant,
        group_id,
        pagination.per_page(),
        pagination.offset(),
    )
    .await
    .map(|msgs| Json(serde_json::to_value(msgs).unwrap()))
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })
}

/// GET /messages/thread/individual/:parent_id
pub async fn get_individual_thread(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    _user: AuthenticatedUser,
    Path(parent_id): Path<Uuid>,
    Query(pagination): Query<PaginationQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    MessageService::get_individual_thread(
        &state.db,
        &tenant,
        parent_id,
        pagination.per_page(),
        pagination.offset(),
    )
    .await
    .map(|msgs| Json(serde_json::to_value(msgs).unwrap()))
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })
}

/// POST /messages/send-to-parents — envoyer un message à des parents avec email automatique
pub async fn send_to_parents(
    State(mut state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,
    Json(body): Json<SendToParentsRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    crate::routes::demo::deny_if_demo(&tenant)?;
    // Only educators and admins can send messages to parents
    if let UserRole::Parent = user.role {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Accès refusé" }))));
    }

    let (msg, recipients) = MessageService::send_to_parents(&state.db, &tenant, user.user_id, &body)
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": e.to_string() })),
            )
        })?;

    // Send emails asynchronously
    if let Some(email_svc) = state.email.clone() {
        let pool = state.db.clone();
        let tenant_c = tenant.clone();
        let subject = body.subject.clone();
        let content = body.content.clone();
        tokio::spawn(async move {
            let (garderie_name, logo_url): (String, Option<String>) = sqlx::query_as(
                "SELECT name, logo_url FROM public.garderies WHERE slug = $1",
            )
            .bind(&tenant_c)
            .fetch_optional(&pool)
            .await
            .unwrap_or_default()
            .unwrap_or_else(|| (tenant_c.clone(), None));
            let logo_url = logo_url.unwrap_or_default();
            let _ = email_svc.send_to_parents(recipients, &subject, &content, &garderie_name, &logo_url).await;
        });
    }

    // Publish to Redis for real-time delivery
    let payload = serde_json::to_string(&msg).unwrap_or_default();
    let channel = format!("tenant:{}:messages", tenant);
    let _ = state.redis.publish::<_, _, ()>(&channel, &payload).await;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::to_value(msg).unwrap()),
    ))
}
