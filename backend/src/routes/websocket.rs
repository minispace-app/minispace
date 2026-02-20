use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tracing::{error, info};

use crate::{
    middleware::auth::decode_access_token,
    middleware::tenant::TenantSlug,
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct WsQueryParams {
    pub token: String,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    Query(params): Query<WsQueryParams>,
) -> Response {
    let jwt_secret = state.config.jwt_secret.clone();
    let auth_user = decode_access_token(&params.token, &jwt_secret);

    ws.on_upgrade(move |socket| async move {
        match auth_user {
            Ok(user) => {
                info!(
                    "WebSocket connected: user={} tenant={}",
                    user.user_id, tenant
                );
                handle_socket(socket, state, tenant, user.user_id.to_string()).await;
            }
            Err(e) => {
                error!("WebSocket auth failed: {}", e);
            }
        }
    })
}

async fn handle_socket(
    socket: WebSocket,
    state: AppState,
    tenant: String,
    user_id: String,
) {
    let (mut sender, mut receiver) = socket.split();

    // Create a dedicated pub/sub connection from the client
    let channel = format!("tenant:{}:messages", tenant);
    let mut pubsub = match state.redis_client.get_async_pubsub().await {
        Ok(c) => c,
        Err(e) => {
            error!("Redis pubsub error: {}", e);
            return;
        }
    };

    if let Err(e) = pubsub.subscribe(&channel).await {
        error!("Redis subscribe error: {}", e);
        return;
    }

    // Spawn task: Redis Pub/Sub → WebSocket
    let mut redis_task = tokio::spawn(async move {
        let mut pubsub_stream = pubsub.on_message();
        while let Some(msg) = pubsub_stream.next().await {
            let payload: String = match msg.get_payload() {
                Ok(p) => p,
                Err(_) => continue,
            };
            let ws_msg = serde_json::json!({
                "type": "new_message",
                "payload": serde_json::from_str::<serde_json::Value>(&payload)
                    .unwrap_or(serde_json::Value::String(payload))
            });
            if sender
                .send(Message::Text(ws_msg.to_string().into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    // Receive messages from the client
    let mut client_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    info!("WS message from {}: {}", user_id, text);
                }
                Message::Ping(_) => {}
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = (&mut redis_task) => client_task.abort(),
        _ = (&mut client_task) => redis_task.abort(),
    }

    info!("WebSocket disconnected");
}
