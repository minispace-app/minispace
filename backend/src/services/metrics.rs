use lazy_static::lazy_static;
use prometheus::{register_counter_vec, register_gauge_vec, register_gauge, CounterVec, GaugeVec, Gauge};
use sqlx::PgPool;
use tracing::{info, warn};

lazy_static! {
    // ── Event counters (increment on each event) ────────────────────────────
    pub static ref LOGINS_COUNTER: CounterVec = register_counter_vec!(
        "api_logins_total",
        "Tentatives de login par tenant et statut",
        &["tenant", "status"]
    ).unwrap();

    pub static ref TWO_FA_COUNTER: CounterVec = register_counter_vec!(
        "api_2fa_emails_total",
        "Emails 2FA envoyés par tenant",
        &["tenant"]
    ).unwrap();

    pub static ref INVITATIONS_COUNTER: CounterVec = register_counter_vec!(
        "api_invitations_total",
        "Invitations envoyées par tenant",
        &["tenant"]
    ).unwrap();

    pub static ref PASSWORD_RESETS_COUNTER: CounterVec = register_counter_vec!(
        "api_password_resets_total",
        "Demandes de réinitialisation de mot de passe par tenant",
        &["tenant"]
    ).unwrap();

    pub static ref MEDIA_UPLOADS_COUNTER: CounterVec = register_counter_vec!(
        "api_media_uploads_total",
        "Fichiers média uploadés par tenant",
        &["tenant"]
    ).unwrap();

    pub static ref DOCUMENT_UPLOADS_COUNTER: CounterVec = register_counter_vec!(
        "api_document_uploads_total",
        "Documents uploadés par tenant",
        &["tenant"]
    ).unwrap();

    pub static ref MESSAGES_COUNTER: CounterVec = register_counter_vec!(
        "api_messages_sent_total",
        "Messages envoyés par tenant",
        &["tenant"]
    ).unwrap();

    pub static ref JOURNAL_EMAILS_COUNTER: CounterVec = register_counter_vec!(
        "api_journal_emails_total",
        "Emails journal envoyés par tenant (événement)",
        &["tenant"]
    ).unwrap();

    // ── Business metrics ────────────────────────────────────────────────────
    pub static ref USERS_GAUGE: GaugeVec = register_gauge_vec!(
        "garderie_users_total",
        "Utilisateurs actifs par tenant et rôle",
        &["tenant", "role"]
    ).unwrap();

    pub static ref CHILDREN_GAUGE: GaugeVec = register_gauge_vec!(
        "garderie_children_active_total",
        "Enfants actifs par tenant",
        &["tenant"]
    ).unwrap();

    pub static ref JOURNALS_SENT_GAUGE: GaugeVec = register_gauge_vec!(
        "garderie_journals_sent_total",
        "Emails journal envoyés par tenant (cumulatif)",
        &["tenant"]
    ).unwrap();

    pub static ref MESSAGES_GAUGE: GaugeVec = register_gauge_vec!(
        "garderie_messages_total",
        "Messages totaux par tenant",
        &["tenant"]
    ).unwrap();

    pub static ref MEDIA_GAUGE: GaugeVec = register_gauge_vec!(
        "garderie_media_files_total",
        "Fichiers média par tenant",
        &["tenant"]
    ).unwrap();

    pub static ref DOCUMENTS_GAUGE: GaugeVec = register_gauge_vec!(
        "garderie_documents_total",
        "Documents par tenant",
        &["tenant"]
    ).unwrap();

    pub static ref TENANTS_GAUGE: Gauge = register_gauge!(
        "garderie_tenants_active_total",
        "Nombre de tenants actifs"
    ).unwrap();
}

/// Spawn the background metrics collector (refreshes every 5 minutes).
pub fn start(pool: PgPool) {
    tokio::spawn(async move {
        // Initial collection on startup
        if let Err(e) = collect(&pool).await {
            warn!("Metrics: initial collection failed: {}", e);
        }
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;
            if let Err(e) = collect(&pool).await {
                warn!("Metrics: collection failed: {}", e);
            }
        }
    });
}

async fn collect(pool: &PgPool) -> anyhow::Result<()> {
    let tenants: Vec<String> =
        sqlx::query_scalar("SELECT slug FROM public.garderies WHERE is_active = TRUE")
            .fetch_all(pool)
            .await?;

    TENANTS_GAUGE.set(tenants.len() as f64);

    for slug in &tenants {
        let schema = format!("garderie_{}", slug);

        // Users by role
        let user_counts: Vec<(String, i64)> = sqlx::query_as(&format!(
            r#"SELECT role::TEXT, COUNT(*)::BIGINT FROM "{schema}".users WHERE is_active = TRUE GROUP BY role"#
        ))
        .fetch_all(pool)
        .await
        .unwrap_or_default();

        for (role, count) in user_counts {
            USERS_GAUGE.with_label_values(&[slug, &role]).set(count as f64);
        }

        // Active children
        let children: i64 = sqlx::query_scalar(&format!(
            r#"SELECT COUNT(*)::BIGINT FROM "{schema}".children WHERE is_active = TRUE"#
        ))
        .fetch_one(pool)
        .await
        .unwrap_or(0);
        CHILDREN_GAUGE.with_label_values(&[slug]).set(children as f64);

        // Journals sent
        let journals: i64 = sqlx::query_scalar(&format!(
            r#"SELECT COUNT(*)::BIGINT FROM "{schema}".daily_journals WHERE sent_at IS NOT NULL"#
        ))
        .fetch_one(pool)
        .await
        .unwrap_or(0);
        JOURNALS_SENT_GAUGE.with_label_values(&[slug]).set(journals as f64);

        // Messages
        let messages: i64 = sqlx::query_scalar(&format!(
            r#"SELECT COUNT(*)::BIGINT FROM "{schema}".messages"#
        ))
        .fetch_one(pool)
        .await
        .unwrap_or(0);
        MESSAGES_GAUGE.with_label_values(&[slug]).set(messages as f64);

        // Media files
        let media: i64 = sqlx::query_scalar(&format!(
            r#"SELECT COUNT(*)::BIGINT FROM "{schema}".media"#
        ))
        .fetch_one(pool)
        .await
        .unwrap_or(0);
        MEDIA_GAUGE.with_label_values(&[slug]).set(media as f64);

        // Documents
        let documents: i64 = sqlx::query_scalar(&format!(
            r#"SELECT COUNT(*)::BIGINT FROM "{schema}".documents"#
        ))
        .fetch_one(pool)
        .await
        .unwrap_or(0);
        DOCUMENTS_GAUGE.with_label_values(&[slug]).set(documents as f64);
    }

    info!("Metrics: collected for {} tenant(s)", tenants.len());
    Ok(())
}
