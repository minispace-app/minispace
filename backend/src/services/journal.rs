use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
    models::journal::{
        DailyJournal, UpsertJournalRequest, APPETIT_LEVELS, HUMEUR_LEVELS, WEATHER_CONDITIONS,
    },
};

pub struct JournalService;

impl JournalService {
    /// Fetch all journal entries for one child between Monday and Friday of the given week.
    pub async fn list_week(
        pool: &PgPool,
        tenant: &str,
        child_id: Uuid,
        week_start: NaiveDate,
    ) -> anyhow::Result<Vec<DailyJournal>> {
        let schema = schema_name(tenant);
        let week_end = week_start + chrono::Duration::days(4); // Friday
        let entries = sqlx::query_as::<_, DailyJournal>(&format!(
            r#"SELECT id, child_id, date,
                      temperature::TEXT AS temperature,
                      menu,
                      appetit::TEXT     AS appetit,
                      humeur::TEXT      AS humeur,
                      sommeil_minutes,
                      absent,
                      sante, medicaments, message_educatrice, observations,
                      created_by, created_at, updated_at
               FROM "{schema}".daily_journals
               WHERE child_id = $1 AND date BETWEEN $2 AND $3
               ORDER BY date"#
        ))
        .bind(child_id)
        .bind(week_start)
        .bind(week_end)
        .fetch_all(pool)
        .await?;
        Ok(entries)
    }

    /// Insert or update a journal entry for (child_id, date).
    pub async fn upsert(
        pool: &PgPool,
        tenant: &str,
        req: &UpsertJournalRequest,
        created_by: Uuid,
    ) -> anyhow::Result<DailyJournal> {
        // Validate enum values server-side before sending to DB.
        if let Some(ref v) = req.temperature {
            anyhow::ensure!(
                WEATHER_CONDITIONS.contains(&v.as_str()),
                "Valeur de température invalide: {v}"
            );
        }
        if let Some(ref v) = req.appetit {
            anyhow::ensure!(
                APPETIT_LEVELS.contains(&v.as_str()),
                "Valeur d'appétit invalide: {v}"
            );
        }
        if let Some(ref v) = req.humeur {
            anyhow::ensure!(
                HUMEUR_LEVELS.contains(&v.as_str()),
                "Valeur d'humeur invalide: {v}"
            );
        }
        if let Some(m) = req.sommeil_minutes {
            anyhow::ensure!(
                (0..=180).contains(&m),
                "sommeil_minutes doit être entre 0 et 180"
            );
        }

        let schema = schema_name(tenant);
        let entry = sqlx::query_as::<_, DailyJournal>(&format!(
            r#"INSERT INTO "{schema}".daily_journals
                   (child_id, date, temperature, menu, appetit, humeur,
                    sommeil_minutes, absent, sante, medicaments, message_educatrice,
                    observations, created_by)
               VALUES ($1, $2,
                       $3::"{schema}".weather_condition,
                       $4,
                       $5::"{schema}".appetit_level,
                       $6::"{schema}".humeur_level,
                       $7, $8, $9, $10, $11, $12, $13)
               ON CONFLICT (child_id, date) DO UPDATE SET
                   temperature        = EXCLUDED.temperature,
                   menu               = EXCLUDED.menu,
                   appetit            = EXCLUDED.appetit,
                   humeur             = EXCLUDED.humeur,
                   sommeil_minutes    = EXCLUDED.sommeil_minutes,
                   absent             = EXCLUDED.absent,
                   sante              = EXCLUDED.sante,
                   medicaments        = EXCLUDED.medicaments,
                   message_educatrice = EXCLUDED.message_educatrice,
                   observations       = EXCLUDED.observations
               RETURNING
                   id, child_id, date,
                   temperature::TEXT AS temperature,
                   menu,
                   appetit::TEXT     AS appetit,
                   humeur::TEXT      AS humeur,
                   sommeil_minutes,
                   absent,
                   sante, medicaments, message_educatrice, observations,
                   created_by, created_at, updated_at"#
        ))
        .bind(req.child_id)
        .bind(req.date)
        .bind(&req.temperature)
        .bind(&req.menu)
        .bind(&req.appetit)
        .bind(&req.humeur)
        .bind(req.sommeil_minutes)
        .bind(req.absent)
        .bind(&req.sante)
        .bind(&req.medicaments)
        .bind(&req.message_educatrice)
        .bind(&req.observations)
        .bind(created_by)
        .fetch_one(pool)
        .await?;
        Ok(entry)
    }

    /// Auto-send today's journal entries for all children of a tenant.
    /// Only sends entries that have content (or are absent) and haven't been sent yet.
    /// Returns the number of emails sent.
    pub async fn auto_send_today(
        pool: &PgPool,
        email_svc: Option<&crate::services::email::EmailService>,
        tenant: &str,
        today: NaiveDate,
    ) -> anyhow::Result<usize> {
        let schema = schema_name(tenant);

        // Find child_ids with unsent entries that have content or are absent
        let child_ids: Vec<Uuid> = sqlx::query_scalar(&format!(
            r#"SELECT child_id FROM "{schema}".daily_journals
               WHERE date = $1
                 AND sent_at IS NULL
                 AND (absent = true
                      OR temperature IS NOT NULL OR menu IS NOT NULL
                      OR appetit IS NOT NULL     OR humeur IS NOT NULL
                      OR sommeil_minutes IS NOT NULL
                      OR sante IS NOT NULL        OR medicaments IS NOT NULL
                      OR message_educatrice IS NOT NULL
                      OR observations IS NOT NULL)"#
        ))
        .bind(today)
        .fetch_all(pool)
        .await?;

        if child_ids.is_empty() {
            return Ok(0);
        }

        let garderie_name: String = sqlx::query_scalar(
            "SELECT name FROM public.garderies WHERE slug = $1",
        )
        .bind(tenant)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| tenant.to_string());

        let mut total_sent = 0usize;

        for child_id in child_ids {
            let child_name: Option<(String, String)> = sqlx::query_as(&format!(
                r#"SELECT first_name, last_name FROM "{schema}".children WHERE id = $1"#
            ))
            .bind(child_id)
            .fetch_optional(pool)
            .await?;

            let (first, last) = match child_name {
                Some(n) => n,
                None => continue,
            };

            let parents: Vec<(String, String)> = sqlx::query_as(&format!(
                r#"SELECT u.email, CONCAT(u.first_name, ' ', u.last_name)
                   FROM "{schema}".users u
                   INNER JOIN "{schema}".child_parents cp ON u.id = cp.user_id
                   WHERE cp.child_id = $1 AND u.is_active = TRUE"#
            ))
            .bind(child_id)
            .fetch_all(pool)
            .await?;

            if parents.is_empty() {
                continue;
            }

            // Fetch the entry for today
            let entry: Option<DailyJournal> = sqlx::query_as(&format!(
                r#"SELECT id, child_id, date,
                          temperature::TEXT AS temperature,
                          menu,
                          appetit::TEXT     AS appetit,
                          humeur::TEXT      AS humeur,
                          sommeil_minutes,
                          absent,
                          sante, medicaments, message_educatrice, observations,
                          created_by, created_at, updated_at
                   FROM "{schema}".daily_journals
                   WHERE child_id = $1 AND date = $2"#
            ))
            .bind(child_id)
            .bind(today)
            .fetch_optional(pool)
            .await?;

            let entry = match entry {
                Some(e) => e,
                None => continue,
            };

            if let Some(svc) = email_svc {
                let html = build_journal_email_html(
                    &first, &last, today, today, &[entry], &garderie_name,
                );
                let subject = format!(
                    "Journal de bord de {} {} — {}",
                    first,
                    last,
                    today.format("%d/%m/%Y")
                );
                for (parent_email, parent_name) in &parents {
                    let _ = svc.send_journal(parent_email, parent_name, &html, &subject).await;
                    total_sent += 1;
                }
            }

            // Mark entry as sent regardless of email being configured
            sqlx::query(&format!(
                r#"UPDATE "{schema}".daily_journals
                   SET sent_at = NOW()
                   WHERE child_id = $1 AND date = $2"#
            ))
            .bind(child_id)
            .bind(today)
            .execute(pool)
            .await?;
        }

        Ok(total_sent)
    }

    /// Returns true if the given user is a parent of the child.
    pub async fn assert_parent_access(
        pool: &PgPool,
        tenant: &str,
        child_id: Uuid,
        user_id: Uuid,
    ) -> anyhow::Result<bool> {
        let schema = schema_name(tenant);
        let exists: bool = sqlx::query_scalar(&format!(
            r#"SELECT EXISTS(
                 SELECT 1 FROM "{schema}".child_parents
                 WHERE child_id = $1 AND user_id = $2
               )"#
        ))
        .bind(child_id)
        .bind(user_id)
        .fetch_one(pool)
        .await?;
        Ok(exists)
    }

    /// Send weekly journals for ALL active children to their parents in one shot.
    pub async fn send_all_journals_to_parents(
        pool: &PgPool,
        email_svc: Option<&crate::services::email::EmailService>,
        tenant: &str,
        week_start: NaiveDate,
    ) -> anyhow::Result<String> {
        let schema = schema_name(tenant);

        let children: Vec<(Uuid, String, String)> = sqlx::query_as(&format!(
            r#"SELECT id, first_name, last_name FROM "{schema}".children WHERE is_active = TRUE"#
        ))
        .fetch_all(pool)
        .await?;

        if children.is_empty() {
            anyhow::bail!("Aucun enfant actif trouvé");
        }

        let garderie_name: String = sqlx::query_scalar(
            "SELECT name FROM public.garderies WHERE slug = $1",
        )
        .bind(tenant)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| tenant.to_string());

        let week_end = week_start + chrono::Duration::days(4);
        let mut total_sent: usize = 0;
        let mut skipped: usize = 0;

        for (child_id, child_first, child_last) in &children {
            let entries = Self::list_week(pool, tenant, *child_id, week_start).await?;
            if entries.is_empty() {
                skipped += 1;
                continue;
            }

            let parents: Vec<(String, String)> = sqlx::query_as(&format!(
                r#"SELECT u.email, CONCAT(u.first_name, ' ', u.last_name)
                   FROM "{schema}".users u
                   INNER JOIN "{schema}".child_parents cp ON u.id = cp.user_id
                   WHERE cp.child_id = $1 AND u.is_active = TRUE"#
            ))
            .bind(child_id)
            .fetch_all(pool)
            .await?;

            if parents.is_empty() {
                skipped += 1;
                continue;
            }

            if let Some(svc) = email_svc {
                let html = build_journal_email_html(
                    child_first, child_last, week_start, week_end, &entries, &garderie_name,
                );
                let subject = format!(
                    "Journal de bord de {} {} - Semaine du {}",
                    child_first,
                    child_last,
                    week_start.format("%d/%m/%Y")
                );
                for (parent_email, parent_name) in &parents {
                    let _ = svc.send_journal(parent_email, parent_name, &html, &subject).await;
                    total_sent += 1;
                }
            }
        }

        Ok(format!(
            "Journaux envoyés à {} parent(s) ({} enfant(s) ignoré(s))",
            total_sent, skipped
        ))
    }

    /// Send weekly journal entries for a child to all parents as HTML email.
    pub async fn send_journal_to_parents(
        pool: &PgPool,
        email_svc: Option<&crate::services::email::EmailService>,
        tenant: &str,
        child_id: Uuid,
        week_start: NaiveDate,
    ) -> anyhow::Result<String> {
        let schema = schema_name(tenant);

        // Fetch child info
        let (child_first_name, child_last_name): (String, String) = sqlx::query_as(&format!(
            r#"SELECT first_name, last_name FROM "{schema}".children WHERE id = $1"#
        ))
        .bind(child_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Enfant non trouvé"))?;

        // Fetch parents
        let parents: Vec<(String, String)> = sqlx::query_as(&format!(
            r#"SELECT u.email, CONCAT(u.first_name, ' ', u.last_name)
               FROM "{schema}".users u
               INNER JOIN "{schema}".child_parents cp ON u.id = cp.user_id
               WHERE cp.child_id = $1 AND u.is_active = TRUE"#
        ))
        .bind(child_id)
        .fetch_all(pool)
        .await?;

        if parents.is_empty() {
            anyhow::bail!("Aucun parent assigné à cet enfant");
        }

        // Fetch journal entries for the week
        let entries = Self::list_week(pool, tenant, child_id, week_start).await?;

        if entries.is_empty() {
            anyhow::bail!("Aucun journal disponible pour cette semaine");
        }

        let garderie_name: String = sqlx::query_scalar(
            "SELECT name FROM public.garderies WHERE slug = $1"
        )
        .bind(tenant)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| tenant.to_string());

        let week_end = week_start + chrono::Duration::days(4);

        // Build HTML email
        let html = build_journal_email_html(&child_first_name, &child_last_name, week_start, week_end, &entries, &garderie_name);

        // Send to all parents
        if let Some(svc) = email_svc {
            for (parent_email, parent_name) in &parents {
                let subject = format!(
                    "Journal de bord de {} {} - Semaine du {}",
                    child_first_name, child_last_name,
                    week_start.format("%d/%m/%Y")
                );

                // Ignore send errors — graceful degradation
                let _ = svc.send_journal(parent_email, parent_name, &html, &subject).await;
            }
        }

        Ok(format!(
            "Journal envoyé à {} parent(s)",
            parents.len()
        ))
    }
}

fn fmt_temperature(v: &str) -> &str {
    match v {
        "ensoleille" => "☀️ Ensoleillé",
        "nuageux"    => "⛅ Nuageux",
        "pluie"      => "🌧️ Pluie",
        "neige"      => "❄️ Neige",
        "orageux"    => "⛈️ Orageux",
        _ => v,
    }
}

fn fmt_appetit(v: &str) -> &str {
    match v {
        "comme_habitude" => "😊 Comme d'habitude",
        "peu"            => "😐 Peu",
        "beaucoup"       => "😄 Beaucoup",
        "refuse"         => "😤 Refuse",
        _ => v,
    }
}

fn fmt_humeur(v: &str) -> &str {
    match v {
        "tres_bien" => "😄 Très bien",
        "bien"      => "🙂 Bien",
        "difficile" => "😕 Difficile",
        "pleurs"    => "😢 Pleurs",
        _ => v,
    }
}

fn fmt_date_fr(date: NaiveDate) -> String {
    let days = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
    let months = ["janvier", "février", "mars", "avril", "mai", "juin",
                  "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
    use chrono::Datelike;
    let day_name = days[date.weekday().num_days_from_monday() as usize];
    let month = months[date.month0() as usize];
    format!("{} {} {} {}", day_name, date.day(), month, date.year())
}

fn opt_str(v: Option<&str>) -> &str {
    match v {
        Some(s) if !s.trim().is_empty() => s,
        _ => "—",
    }
}

fn build_journal_email_html(
    child_first: &str,
    child_last: &str,
    week_start: NaiveDate,
    week_end: NaiveDate,
    entries: &[crate::models::journal::DailyJournal],
    garderie_name: &str,
) -> String {
    let period = if week_start == week_end {
        format!("Journal du {} — {}", fmt_date_fr(week_start), garderie_name)
    } else {
        format!(
            "Semaine du {} au {} — {}",
            week_start.format("%d/%m/%Y"),
            week_end.format("%d/%m/%Y"),
            garderie_name
        )
    };

    let mut html = format!(
        r#"<html><body style="font-family:sans-serif;max-width:800px;margin:auto;background:#f9fafb">
        <div style="background:white;border-radius:8px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
            <h2 style="color:#1f2937;margin-bottom:8px">Journal de bord — {first} {last}</h2>
            <p style="color:#6b7280;margin-bottom:24px;font-size:14px">{period}</p>"#,
        first = child_first,
        last = child_last,
        period = period,
    );

    for entry in entries {
        let date_fr = fmt_date_fr(entry.date);

        if entry.absent {
            html.push_str(&format!(
                r#"<div style="border:1px solid #e5e7eb;border-radius:6px;padding:16px;margin-bottom:12px;background:#f9fafb">
                <h3 style="color:#6b7280;margin:0 0 8px 0;font-size:16px">{date}</h3>
                <span style="display:inline-block;background:#fee2e2;color:#b91c1c;font-size:13px;font-weight:600;padding:4px 12px;border-radius:20px">🏠 Absent ce jour</span>
                </div>"#,
                date = date_fr
            ));
            continue;
        }

        let sommeil = match entry.sommeil_minutes {
            Some(m) if m > 0 => format!("{} min", m),
            _ => "—".to_string(),
        };

        html.push_str(&format!(
            r#"<div style="border:1px solid #e5e7eb;border-radius:6px;padding:16px;margin-bottom:12px">
            <h3 style="color:#2563eb;margin:0 0 12px 0;font-size:16px">{date}</h3>
            <table style="width:100%;font-size:14px;color:#374151;border-collapse:collapse">
                <tr><td style="padding:5px 8px 5px 0;width:140px;color:#6b7280"><strong>Température</strong></td><td style="padding:5px 0">{temp}</td></tr>
                <tr><td style="padding:5px 8px 5px 0;color:#6b7280"><strong>Menu</strong></td><td style="padding:5px 0">{menu}</td></tr>
                <tr><td style="padding:5px 8px 5px 0;color:#6b7280"><strong>Appétit</strong></td><td style="padding:5px 0">{appetit}</td></tr>
                <tr><td style="padding:5px 8px 5px 0;color:#6b7280"><strong>Humeur</strong></td><td style="padding:5px 0">{humeur}</td></tr>
                <tr><td style="padding:5px 8px 5px 0;color:#6b7280"><strong>Sommeil</strong></td><td style="padding:5px 0">{sommeil}</td></tr>
                <tr><td style="padding:5px 8px 5px 0;color:#6b7280"><strong>Santé</strong></td><td style="padding:5px 0">{sante}</td></tr>
                <tr><td style="padding:5px 8px 5px 0;color:#6b7280"><strong>Médicaments</strong></td><td style="padding:5px 0">{med}</td></tr>
            </table>"#,
            date    = date_fr,
            temp    = entry.temperature.as_deref().map(fmt_temperature).unwrap_or("—"),
            menu    = opt_str(entry.menu.as_deref()),
            appetit = entry.appetit.as_deref().map(fmt_appetit).unwrap_or("—"),
            humeur  = entry.humeur.as_deref().map(fmt_humeur).unwrap_or("—"),
            sommeil = sommeil,
            sante   = opt_str(entry.sante.as_deref()),
            med     = opt_str(entry.medicaments.as_deref()),
        ));

        if let Some(msg) = &entry.message_educatrice {
            if !msg.trim().is_empty() {
                html.push_str(&format!(
                    r#"<div style="background:#eff6ff;border-left:3px solid #2563eb;padding:8px 12px;margin-top:10px;font-size:13px;border-radius:0 4px 4px 0">
                    <strong style="color:#1d4ed8">💬 Message de l'éducatrice :</strong><br><span style="color:#374151">{msg}</span>
                </div>"#
                ));
            }
        }

        if let Some(obs) = &entry.observations {
            if !obs.trim().is_empty() {
                html.push_str(&format!(
                    r#"<div style="background:#f0fdf4;border-left:3px solid #16a34a;padding:8px 12px;margin-top:8px;font-size:13px;border-radius:0 4px 4px 0">
                    <strong style="color:#15803d">📝 Observations :</strong><br><span style="color:#374151">{obs}</span>
                </div>"#
                ));
            }
        }

        html.push_str("</div>");
    }

    html.push_str(
        r#"<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">
        <p style="margin:0">Cordialement,<br><strong>minispace.app</strong></p>
    </div>
    </div></body></html>"#
    );

    html
}

