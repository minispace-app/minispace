use axum::{extract::State, http::StatusCode, Json};
use serde_json::{json, Value};

use crate::AppState;

pub async fn health_check(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    match sqlx::query("SELECT 1").execute(&state.db).await {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({ "status": "ok", "db": "connected" })),
        ),
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "status": "error", "db": e.to_string() })),
        ),
    }
}
