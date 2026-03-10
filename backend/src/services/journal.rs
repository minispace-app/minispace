use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
    models::journal::{
        DailyJournal, UpsertJournalRequest, APPETIT_LEVELS, HUMEUR_LEVELS, WEATHER_CONDITIONS,
    },
    services::children::ChildService,
};

#[derive(Clone, Debug, sqlx::FromRow)]
struct MenuDuJour {
    collation_matin: Option<String>,
    diner: Option<String>,
    collation_apres_midi: Option<String>,
}

#[derive(Clone, Debug, sqlx::FromRow)]
struct ThemeActivity {
    title: String,
    date: NaiveDate,
    end_date: Option<NaiveDate>,
}

/// Fetch menu du jour (garderie-level menu) for a given date.
async fn fetch_menu_du_jour(
    pool: &PgPool,
    tenant: &str,
    date: NaiveDate,
) -> anyhow::Result<Option<MenuDuJour>> {
    let schema = schema_name(tenant);
    let menu: Option<MenuDuJour> = sqlx::query_as(&format!(
        r#"SELECT collation_matin, diner, collation_apres_midi
           FROM "{schema}".daily_menus
           WHERE date = $1"#
    ))
    .bind(date)
    .fetch_optional(pool)
    .await?;
    Ok(menu)
}

/// Fetch all theme activities that cover a given date.
async fn fetch_themes_for_date(
    pool: &PgPool,
    tenant: &str,
    date: NaiveDate,
) -> anyhow::Result<Vec<ThemeActivity>> {
    let schema = schema_name(tenant);
    let themes: Vec<ThemeActivity> = sqlx::query_as(&format!(
        r#"SELECT title, date, end_date
           FROM "{schema}".activities
           WHERE type = 'theme'
             AND date <= $1
             AND (end_date IS NULL OR end_date >= $1)"#
    ))
    .bind(date)
    .fetch_all(pool)
    .await?;
    Ok(themes)
}

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
    /// Groups journals by parent email to send one email per parent with all their children's journals.
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

        // Build a map of child_id -> (first_name, last_name, DailyJournal)
        let mut child_data: std::collections::HashMap<Uuid, (String, String, DailyJournal)> =
            std::collections::HashMap::new();

        for child_id in &child_ids {
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

            if let Some(e) = entry {
                child_data.insert(*child_id, (first, last, e));
            }
        }

        if child_data.is_empty() {
            return Ok(0);
        }

        // Fetch all parent-child relationships for the children we have entries for
        let parent_child_rows: Vec<(String, String, Uuid)> = sqlx::query_as(&format!(
            r#"SELECT u.email, CONCAT(u.first_name, ' ', u.last_name), cp.child_id
               FROM "{schema}".users u
               INNER JOIN "{schema}".child_parents cp ON u.id = cp.user_id
               WHERE cp.child_id = ANY($1) AND u.is_active = TRUE"#
        ))
        .bind(&child_ids)
        .fetch_all(pool)
        .await?;

        // Fetch pending parents (non-registered) for the same children
        let pending_parent_rows: Vec<(Uuid, String)> =
            ChildService::get_pending_parent_emails_for_children(pool, tenant, &child_ids)
                .await
                .unwrap_or_default();

        // Group by parent_email
        let mut parent_children: std::collections::HashMap<String, (String, Vec<(String, String, DailyJournal)>)> =
            std::collections::HashMap::new();

        for (parent_email, parent_name, child_id) in parent_child_rows {
            if let Some((child_first, child_last, entry)) = child_data.get(&child_id) {
                parent_children
                    .entry(parent_email)
                    .or_insert_with(|| (parent_name.clone(), Vec::new()))
                    .1
                    .push((child_first.clone(), child_last.clone(), entry.clone()));
            }
        }

        // Add pending parents to the same grouping
        for (child_id, pending_email) in pending_parent_rows {
            if let Some((child_first, child_last, entry)) = child_data.get(&child_id) {
                parent_children
                    .entry(pending_email.clone())
                    .or_insert_with(|| ("Parent en attente".to_string(), Vec::new()))
                    .1
                    .push((child_first.clone(), child_last.clone(), entry.clone()));
            }
        }

        let mut total_sent = 0usize;

        // Send one email per parent with all their children's journals
        if let Some(svc) = email_svc {
            for (parent_email, (parent_name, children_entries)) in parent_children {
                // Build subject: if 1 child, use child's name; if multiple, use first names
                let subject = if children_entries.len() == 1 {
                    format!(
                        "Journal de bord de {} {} — {}",
                        children_entries[0].0, children_entries[0].1,
                        today.format("%d/%m/%Y")
                    )
                } else {
                    let first_names: Vec<&str> =
                        children_entries.iter().map(|(f, _, _)| f.as_str()).collect();
                    format!(
                        "Journal de bord de {} — {}",
                        first_names.join(" et "),
                        today.format("%d/%m/%Y")
                    )
                };

                // Fetch theme activities and menu for today
                let themes = fetch_themes_for_date(pool, tenant, today).await.unwrap_or_default();
                let menu = fetch_menu_du_jour(pool, tenant, today).await.unwrap_or(None);

                // Build HTML with all children's journals
                let html = build_journal_email_html_multi(&children_entries, today, &garderie_name, &themes, menu.as_ref());

                let _ = svc
                    .send_journal(&parent_email, &parent_name, &html, &subject, &garderie_name)
                    .await;
                total_sent += 1;
            }
        }

        // Mark all entries as sent
        for child_id in child_ids {
            let _ = sqlx::query(&format!(
                r#"UPDATE "{schema}".daily_journals
                   SET sent_at = NOW()
                   WHERE child_id = $1 AND date = $2"#
            ))
            .bind(child_id)
            .bind(today)
            .execute(pool)
            .await;
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

            // Fetch pending parents for this child
            let pending_parents: Vec<(Uuid, String)> =
                ChildService::get_pending_parent_emails_for_children(pool, tenant, &[*child_id])
                    .await
                    .unwrap_or_default();

            if parents.is_empty() && pending_parents.is_empty() {
                skipped += 1;
                continue;
            }

            if let Some(svc) = email_svc {
                // Fetch theme activities and menus for the week
                let mut themes_for_week = Vec::new();
                let mut menus_for_week = std::collections::HashMap::new();
                for i in 0..5 {
                    let day = week_start + chrono::Duration::days(i);
                    if let Ok(day_themes) = fetch_themes_for_date(pool, tenant, day).await {
                        themes_for_week.extend(day_themes);
                    }
                    if let Ok(menu) = fetch_menu_du_jour(pool, tenant, day).await {
                        if let Some(m) = menu {
                            menus_for_week.insert(day, m);
                        }
                    }
                }

                let html = build_journal_email_html(
                    child_first, child_last, week_start, week_end, &entries, &garderie_name, &themes_for_week, &menus_for_week,
                );
                let subject = format!(
                    "Journal de bord de {} {} - Semaine du {}",
                    child_first,
                    child_last,
                    week_start.format("%d/%m/%Y")
                );
                // Send to registered parents
                for (parent_email, parent_name) in &parents {
                    let _ = svc.send_journal(parent_email, parent_name, &html, &subject, &garderie_name).await;
                    total_sent += 1;
                }
                // Send to pending parents
                for (_child_id, parent_email) in &pending_parents {
                    let _ = svc.send_journal(parent_email, "Parent", &html, &subject, &garderie_name).await;
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

        // Fetch pending parents
        let pending_parents: Vec<(Uuid, String)> =
            ChildService::get_pending_parent_emails_for_children(pool, tenant, &[child_id])
                .await
                .unwrap_or_default();

        if parents.is_empty() && pending_parents.is_empty() {
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

        // Fetch theme activities and menus for the week
        let mut themes_for_week = Vec::new();
        let mut menus_for_week = std::collections::HashMap::new();
        for i in 0..5 {
            let day = week_start + chrono::Duration::days(i);
            if let Ok(day_themes) = fetch_themes_for_date(pool, tenant, day).await {
                themes_for_week.extend(day_themes);
            }
            if let Ok(menu) = fetch_menu_du_jour(pool, tenant, day).await {
                if let Some(m) = menu {
                    menus_for_week.insert(day, m);
                }
            }
        }

        // Build HTML email
        let html = build_journal_email_html(&child_first_name, &child_last_name, week_start, week_end, &entries, &garderie_name, &themes_for_week, &menus_for_week);

        let subject = format!(
            "Journal de bord de {} {} - Semaine du {}",
            child_first_name, child_last_name,
            week_start.format("%d/%m/%Y")
        );

        // Send to all registered and pending parents
        if let Some(svc) = email_svc {
            // Send to registered parents
            for (parent_email, parent_name) in &parents {
                // Ignore send errors — graceful degradation
                let _ = svc.send_journal(parent_email, parent_name, &html, &subject, &garderie_name).await;
            }
            // Send to pending parents
            for (_child_id, parent_email) in &pending_parents {
                let _ = svc.send_journal(parent_email, "Parent", &html, &subject, &garderie_name).await;
            }
        }

        let total = parents.len() + pending_parents.len();
        Ok(format!(
            "Journal envoyé à {} parent(s)",
            total
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
        "comme_habitude" => "Normal",
        "peu"            => "Peu",
        "beaucoup"       => "Beaucoup",
        "refuse"         => "Refuse",
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

fn get_theme_for_date(date: NaiveDate, themes: &[ThemeActivity]) -> Option<String> {
    themes.iter().find_map(|theme| {
        let end = theme.end_date.unwrap_or(theme.date);
        if date >= theme.date && date <= end {
            Some(theme.title.clone())
        } else {
            None
        }
    })
}

fn build_journal_email_html(
    child_first: &str,
    child_last: &str,
    week_start: NaiveDate,
    week_end: NaiveDate,
    entries: &[crate::models::journal::DailyJournal],
    garderie_name: &str,
    themes: &[ThemeActivity],
    menus: &std::collections::HashMap<NaiveDate, MenuDuJour>,
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
            <h3 style="color:#2563eb;margin:0 0 12px 0;font-size:16px">{date}</h3>"#,
            date = date_fr,
        ));

        // Add menu du jour if present
        if let Some(menu) = menus.get(&entry.date) {
            let has_menu = menu.collation_matin.is_some() || menu.diner.is_some() || menu.collation_apres_midi.is_some();
            if has_menu {
                html.push_str(r#"<div style="margin-bottom:12px;font-size:13px">"#);

                if let Some(ref m) = menu.collation_matin {
                    if !m.trim().is_empty() {
                        html.push_str(&format!(
                            r#"<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:10px;margin-bottom:8px">
                            <span style="color:#d97706;font-weight:600">🌅 Collation matin :</span> <span style="color:#92400e">{}</span>
                            </div>"#,
                            m
                        ));
                    }
                }

                if let Some(ref m) = menu.diner {
                    if !m.trim().is_empty() {
                        html.push_str(&format!(
                            r#"<div style="background:#fed7aa;border:1px solid #fdba74;border-radius:6px;padding:10px;margin-bottom:8px">
                            <span style="color:#c2410c;font-weight:600">🍽️ Dîner :</span> <span style="color:#7c2d12">{}</span>
                            </div>"#,
                            m
                        ));
                    }
                }

                if let Some(ref m) = menu.collation_apres_midi {
                    if !m.trim().is_empty() {
                        html.push_str(&format!(
                            r#"<div style="background:#e9d5ff;border:1px solid #d8b4fe;border-radius:6px;padding:10px;margin-bottom:8px">
                            <span style="color:#9333ea;font-weight:600">🌙 Collation après-midi :</span> <span style="color:#5b21b6">{}</span>
                            </div>"#,
                            m
                        ));
                    }
                }

                html.push_str("</div>");
            }
        }

        // Add theme if present for this day
        if let Some(theme) = get_theme_for_date(entry.date, themes) {
            html.push_str(&format!(
                r#"<div style="background:#f3e8ff;border:1px solid #e9d5ff;border-radius:6px;padding:12px;margin-bottom:12px;font-size:14px">
                <span style="color:#7c3aed;font-weight:600">📚 Thème :</span> <span style="color:#6d28d9">{}</span>
                </div>"#,
                theme
            ));
        }

        html.push_str(&format!(
            r#"<table style="width:100%;font-size:14px;color:#374151;border-collapse:collapse">
                <tr><td style="padding:5px 8px 5px 0;width:140px;color:#6b7280"><strong>Température</strong></td><td style="padding:5px 0">{temp}</td></tr>
                <tr><td style="padding:5px 8px 5px 0;color:#6b7280"><strong>Menu</strong></td><td style="padding:5px 0">{menu}</td></tr>
                <tr><td style="padding:5px 8px 5px 0;color:#6b7280"><strong>Appétit</strong></td><td style="padding:5px 0">{appetit}</td></tr>
                <tr><td style="padding:5px 8px 5px 0;color:#6b7280"><strong>Humeur</strong></td><td style="padding:5px 0">{humeur}</td></tr>
                <tr><td style="padding:5px 8px 5px 0;color:#6b7280"><strong>Sommeil</strong></td><td style="padding:5px 0">{sommeil}</td></tr>
                <tr><td style="padding:5px 8px 5px 0;color:#6b7280"><strong>Santé</strong></td><td style="padding:5px 0">{sante}</td></tr>
                <tr><td style="padding:5px 8px 5px 0;color:#6b7280"><strong>Médicaments</strong></td><td style="padding:5px 0">{med}</td></tr>
            </table>"#,
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

    html.push_str(&format!(
        r#"<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">
        <p style="margin:0">Cordialement,<br><strong>{}</strong></p>
    </div>
    </div></body></html>"#,
        garderie_name
    ));

    html
}

/// Builds email HTML for multiple children's journals (grouped by parent).
/// Each child is displayed in its own section.
/// Structure: Header > Theme (if present) > Menu (if present) > Each child's data
fn build_journal_email_html_multi(
    children_entries: &[(String, String, crate::models::journal::DailyJournal)],
    today: NaiveDate,
    garderie_name: &str,
    themes: &[ThemeActivity],
    menu: Option<&MenuDuJour>,
) -> String {
    let period = format!("Journal du {} — {}", fmt_date_fr(today), garderie_name);

    let mut html = format!(
        r#"<html><body style="font-family:sans-serif;max-width:800px;margin:auto;background:#f9fafb">
        <div style="background:white;border-radius:8px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
            <h2 style="color:#1f2937;margin-bottom:8px">Journal de bord</h2>
            <p style="color:#6b7280;margin-bottom:24px;font-size:14px">{period}</p>"#,
        period = period,
    );

    // ─── THEME SECTION (displayed once at top) ───
    if let Some(theme) = get_theme_for_date(today, themes) {
        html.push_str(&format!(
            r#"<div style="background:#f3e8ff;border:2px solid #d8b4fe;border-radius:8px;padding:16px;margin-bottom:24px;font-size:14px">
            <span style="color:#7c3aed;font-weight:700;font-size:15px">📚 Thème de la semaine :</span> <span style="color:#5b21b6;font-weight:600">{}</span>
            </div>"#,
            theme
        ));
    }

    // ─── MENU SECTION (displayed once at top) ───
    if let Some(menu) = menu {
        let has_menu = menu.collation_matin.is_some() || menu.diner.is_some() || menu.collation_apres_midi.is_some();
        if has_menu {
            html.push_str(r#"<div style="background:#fffbeb;border:2px solid #fcd34d;border-radius:8px;padding:16px;margin-bottom:24px">"#);
            html.push_str(r#"<div style="color:#d97706;font-weight:700;font-size:15px;margin-bottom:12px">🍽️ Menu du jour</div>"#);

            if let Some(ref m) = menu.collation_matin {
                if !m.trim().is_empty() {
                    html.push_str(&format!(
                        r#"<div style="background:#fef3c7;border-left:4px solid #fbbf24;padding:10px 12px;margin-bottom:8px;border-radius:4px">
                        <span style="color:#d97706;font-weight:600">🌅 Collation matin :</span> <span style="color:#92400e">{}</span>
                        </div>"#,
                        m
                    ));
                }
            }

            if let Some(ref m) = menu.diner {
                if !m.trim().is_empty() {
                    html.push_str(&format!(
                        r#"<div style="background:#fed7aa;border-left:4px solid #fb923c;padding:10px 12px;margin-bottom:8px;border-radius:4px">
                        <span style="color:#c2410c;font-weight:600">🍽️ Dîner :</span> <span style="color:#7c2d12">{}</span>
                        </div>"#,
                        m
                    ));
                }
            }

            if let Some(ref m) = menu.collation_apres_midi {
                if !m.trim().is_empty() {
                    html.push_str(&format!(
                        r#"<div style="background:#e9d5ff;border-left:4px solid #d8b4fe;padding:10px 12px;margin-bottom:8px;border-radius:4px">
                        <span style="color:#9333ea;font-weight:600">🌙 Collation après-midi :</span> <span style="color:#5b21b6">{}</span>
                        </div>"#,
                        m
                    ));
                }
            }

            html.push_str("</div>");
        }
    }

    // ─── CHILDREN SECTIONS ───
    for (child_first, child_last, entry) in children_entries {
        // Child header
        html.push_str(&format!(
            r#"<h3 style="color:#1f2937;margin-top:20px;margin-bottom:12px;font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px">👶 {first} {last}</h3>"#,
            first = child_first,
            last = child_last,
        ));

        let date_fr = fmt_date_fr(entry.date);

        if entry.absent {
            html.push_str(&format!(
                r#"<div style="border:1px solid #e5e7eb;border-radius:6px;padding:16px;margin-bottom:12px;background:#f9fafb">
                <h4 style="color:#6b7280;margin:0 0 8px 0;font-size:14px">{date}</h4>
                <span style="display:inline-block;background:#fee2e2;color:#b91c1c;font-size:13px;font-weight:600;padding:4px 12px;border-radius:20px">🏠 Absent ce jour</span>
                </div>"#,
                date = date_fr
            ));
        } else {
            let sommeil = match entry.sommeil_minutes {
                Some(m) if m > 0 => format!("{} min", m),
                _ => "—".to_string(),
            };

            html.push_str(&format!(
                r#"<div style="border:1px solid #e5e7eb;border-radius:6px;padding:16px;margin-bottom:12px">
                <h4 style="color:#2563eb;margin:0 0 12px 0;font-size:14px">{date}</h4>"#,
                date = date_fr,
            ));

            // Main data table
            html.push_str(&format!(
                r#"<table style="width:100%;font-size:13px;color:#374151;border-collapse:collapse;margin-bottom:12px">
                    <tr><td style="padding:4px 8px 4px 0;width:120px;color:#6b7280"><strong>Température</strong></td><td style="padding:4px 0">{temp}</td></tr>
                    <tr><td style="padding:4px 8px 4px 0;color:#6b7280"><strong>Appétit</strong></td><td style="padding:4px 0">{appetit}</td></tr>
                    <tr><td style="padding:4px 8px 4px 0;color:#6b7280"><strong>Humeur</strong></td><td style="padding:4px 0">{humeur}</td></tr>
                    <tr><td style="padding:4px 8px 4px 0;color:#6b7280"><strong>Sommeil</strong></td><td style="padding:4px 0">{sommeil}</td></tr>
                    <tr><td style="padding:4px 8px 4px 0;color:#6b7280"><strong>Santé</strong></td><td style="padding:4px 0">{sante}</td></tr>
                    <tr><td style="padding:4px 8px 4px 0;color:#6b7280"><strong>Médicaments</strong></td><td style="padding:4px 0">{med}</td></tr>
                </table>"#,
                temp    = entry.temperature.as_deref().map(fmt_temperature).unwrap_or("—"),
                appetit = entry.appetit.as_deref().map(fmt_appetit).unwrap_or("—"),
                humeur  = entry.humeur.as_deref().map(fmt_humeur).unwrap_or("—"),
                sommeil = sommeil,
                sante   = opt_str(entry.sante.as_deref()),
                med     = opt_str(entry.medicaments.as_deref()),
            ));

            // Note alimentaire (food note from child's journal.menu)
            if let Some(ref food_note) = entry.menu {
                if !food_note.trim().is_empty() {
                    html.push_str(&format!(
                        r#"<div style="background:#f0fdf4;border-left:3px solid #16a34a;padding:10px 12px;margin-bottom:12px;font-size:13px;border-radius:0 4px 4px 0">
                        <strong style="color:#15803d">📝 Note alimentaire :</strong><br><span style="color:#374151">{}</span>
                    </div>"#,
                        food_note
                    ));
                }
            }

            if let Some(msg) = &entry.message_educatrice {
                if !msg.trim().is_empty() {
                    html.push_str(&format!(
                        r#"<div style="background:#eff6ff;border-left:3px solid #2563eb;padding:10px 12px;margin-bottom:12px;font-size:13px;border-radius:0 4px 4px 0">
                        <strong style="color:#1d4ed8">💬 Message de l'éducatrice :</strong><br><span style="color:#374151">{}</span>
                    </div>"#,
                        msg
                    ));
                }
            }

            if let Some(obs) = &entry.observations {
                if !obs.trim().is_empty() {
                    html.push_str(&format!(
                        r#"<div style="background:#fef2f2;border-left:3px solid #dc2626;padding:10px 12px;font-size:13px;border-radius:0 4px 4px 0">
                        <strong style="color:#991b1b">🔍 Observations :</strong><br><span style="color:#374151">{}</span>
                    </div>"#,
                        obs
                    ));
                }
            }

            html.push_str("</div>");
        }
    }

    html.push_str(&format!(
        r#"<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">
        <p style="margin:0">Cordialement,<br><strong>{}</strong></p>
    </div>
    </div></body></html>"#,
        garderie_name
    ));

    html
}

