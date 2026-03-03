use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "plan_type", rename_all = "snake_case")]
#[serde(rename_all = "lowercase")]
pub enum PlanType {
    Free,
    Standard,
    Premium,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Garderie {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub logo_url: Option<String>,
    pub plan: PlanType,
    pub is_active: bool,
    pub trial_expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateGarderieRequest {
    pub slug: String,
    pub name: String,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub plan: Option<PlanType>,
}

/// Loi 25 — consentement enregistré lors du signup admin garderie.
#[derive(Debug, Deserialize)]
pub struct SignupConsentPayload {
    pub privacy_accepted: bool,
    pub parents_commitment_accepted: Option<bool>,
    pub accepted_at: chrono::DateTime<Utc>,
    pub policy_version: String,
    pub language: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SignupRequest {
    pub slug: String,
    pub name: String,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub password: String,
    /// Loi 25 — métadonnées de consentement horodatées.
    /// Optionnel pour rétrocompatibilité mais persisté si fourni.
    pub consent: Option<SignupConsentPayload>,
}
