use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Arc;

use calamine::{open_workbook_from_rs, Data, Reader, Xlsx};
use chrono::{NaiveDate, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
    models::child::{AssignParentRequest, AssignPendingParentRequest, Child, ChildParentUser, CreateChildRequest, ImportResult, ImportRowError, InvitedParent, PendingParent, UpdateChildRequest},
    models::group::CreateGroupRequest,
    services::{email::EmailService, groups::GroupService},
};

pub struct ChildService;

impl ChildService {
    pub async fn list(pool: &PgPool, tenant: &str) -> anyhow::Result<Vec<Child>> {
        let schema = schema_name(tenant);
        let children = sqlx::query_as::<_, Child>(&format!(
            "SELECT * FROM {schema}.children WHERE is_active = TRUE ORDER BY last_name, first_name"
        ))
        .fetch_all(pool)
        .await?;
        Ok(children)
    }

    pub async fn list_for_parent(
        pool: &PgPool,
        tenant: &str,
        parent_id: Uuid,
    ) -> anyhow::Result<Vec<Child>> {
        let schema = schema_name(tenant);
        let children = sqlx::query_as::<_, Child>(&format!(
            "SELECT c.* FROM {schema}.children c
             JOIN {schema}.child_parents cp ON cp.child_id = c.id
             WHERE cp.user_id = $1 AND c.is_active = TRUE
             ORDER BY c.last_name, c.first_name"
        ))
        .bind(parent_id)
        .fetch_all(pool)
        .await?;
        Ok(children)
    }

    pub async fn create(
        pool: &PgPool,
        tenant: &str,
        req: &CreateChildRequest,
    ) -> anyhow::Result<Child> {
        let schema = schema_name(tenant);
        let child = sqlx::query_as::<_, Child>(&format!(
            "INSERT INTO {schema}.children (first_name, last_name, birth_date, group_id, notes, start_date, schedule_days)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *"
        ))
        .bind(&req.first_name)
        .bind(&req.last_name)
        .bind(req.birth_date)
        .bind(req.group_id)
        .bind(&req.notes)
        .bind(req.start_date)
        .bind(&req.schedule_days)
        .fetch_one(pool)
        .await?;
        Ok(child)
    }

    pub async fn update(
        pool: &PgPool,
        tenant: &str,
        id: Uuid,
        req: &UpdateChildRequest,
    ) -> anyhow::Result<Child> {
        let schema = schema_name(tenant);
        let child = sqlx::query_as::<_, Child>(&format!(
            "UPDATE {schema}.children
             SET first_name    = COALESCE($1, first_name),
                 last_name     = COALESCE($2, last_name),
                 birth_date    = COALESCE($3, birth_date),
                 group_id      = COALESCE($4, group_id),
                 notes         = COALESCE($5, notes),
                 is_active     = COALESCE($6, is_active),
                 start_date    = COALESCE($8, start_date),
                 schedule_days = COALESCE($9, schedule_days),
                 updated_at    = NOW()
             WHERE id = $7
             RETURNING *"
        ))
        .bind(&req.first_name)
        .bind(&req.last_name)
        .bind(req.birth_date)
        .bind(req.group_id)
        .bind(&req.notes)
        .bind(req.is_active)
        .bind(id)
        .bind(req.start_date)
        .bind(&req.schedule_days)
        .fetch_one(pool)
        .await?;
        Ok(child)
    }

    pub async fn is_parent_of(
        pool: &PgPool,
        tenant: &str,
        child_id: Uuid,
        user_id: Uuid,
    ) -> anyhow::Result<bool> {
        let schema = schema_name(tenant);
        let exists: bool = sqlx::query_scalar(&format!(
            "SELECT EXISTS(SELECT 1 FROM {schema}.child_parents WHERE child_id = $1 AND user_id = $2)"
        ))
        .bind(child_id)
        .bind(user_id)
        .fetch_one(pool)
        .await?;
        Ok(exists)
    }

    pub async fn list_parents_for_child(
        pool: &PgPool,
        tenant: &str,
        child_id: Uuid,
    ) -> anyhow::Result<Vec<ChildParentUser>> {
        let schema = schema_name(tenant);
        let parents = sqlx::query_as::<_, ChildParentUser>(&format!(
            "SELECT u.id as user_id, u.first_name, u.last_name, u.email, cp.relationship
             FROM {schema}.child_parents cp
             JOIN {schema}.users u ON u.id = cp.user_id
             WHERE cp.child_id = $1
             ORDER BY u.last_name, u.first_name"
        ))
        .bind(child_id)
        .fetch_all(pool)
        .await?;
        Ok(parents)
    }

    pub async fn remove_parent(
        pool: &PgPool,
        tenant: &str,
        child_id: Uuid,
        user_id: Uuid,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);
        sqlx::query(&format!(
            "DELETE FROM {schema}.child_parents WHERE child_id = $1 AND user_id = $2"
        ))
        .bind(child_id)
        .bind(user_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Soft-delete a child (mark as deleted).
    /// Actual hard-delete happens after retention period expires via purge cron job.
    /// Retention: attendance duration + 1 year (per privacy policy).
    pub async fn delete(
        pool: &PgPool,
        tenant: &str,
        child_id: Uuid,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);
        sqlx::query(&format!(
            "UPDATE {schema}.children
             SET is_active = FALSE, is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW()
             WHERE id = $1"
        ))
        .bind(child_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn assign_parent(
        pool: &PgPool,
        tenant: &str,
        child_id: Uuid,
        req: &AssignParentRequest,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);
        sqlx::query(&format!(
            "INSERT INTO {schema}.child_parents (child_id, user_id, relationship)
             VALUES ($1, $2, $3)
             ON CONFLICT (child_id, user_id) DO UPDATE SET relationship = EXCLUDED.relationship"
        ))
        .bind(child_id)
        .bind(req.user_id)
        .bind(&req.relationship)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn assign_pending_parent(
        pool: &PgPool,
        tenant: &str,
        child_id: Uuid,
        req: &AssignPendingParentRequest,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);
        sqlx::query(&format!(
            "INSERT INTO {schema}.child_pending_parents (child_id, email, relationship)
             VALUES ($1, $2, $3)
             ON CONFLICT (child_id, email) DO UPDATE SET relationship = EXCLUDED.relationship"
        ))
        .bind(child_id)
        .bind(&req.email)
        .bind(&req.relationship)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn remove_pending_parent(
        pool: &PgPool,
        tenant: &str,
        child_id: Uuid,
        email: &str,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);
        sqlx::query(&format!(
            "DELETE FROM {schema}.child_pending_parents WHERE child_id = $1 AND email = $2"
        ))
        .bind(child_id)
        .bind(email)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn list_pending_parents_for_child(
        pool: &PgPool,
        tenant: &str,
        child_id: Uuid,
    ) -> anyhow::Result<Vec<PendingParent>> {
        let schema = schema_name(tenant);
        let parents = sqlx::query_as::<_, PendingParent>(&format!(
            "SELECT * FROM {schema}.child_pending_parents
             WHERE child_id = $1
             ORDER BY created_at DESC"
        ))
        .bind(child_id)
        .fetch_all(pool)
        .await?;
        Ok(parents)
    }

    pub async fn promote_pending_parents(
        pool: &PgPool,
        tenant: &str,
        user_id: Uuid,
        email: &str,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);
        // Move pending parent records to child_parents table
        sqlx::query(&format!(
            "INSERT INTO {schema}.child_parents (child_id, user_id, relationship)
             SELECT child_id, $1, relationship FROM {schema}.child_pending_parents WHERE email = $2
             ON CONFLICT (child_id, user_id) DO UPDATE SET relationship = EXCLUDED.relationship"
        ))
        .bind(user_id)
        .bind(email)
        .execute(pool)
        .await?;

        // Delete the pending records
        sqlx::query(&format!(
            "DELETE FROM {schema}.child_pending_parents WHERE email = $1"
        ))
        .bind(email)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn get_pending_parent_emails_for_children(
        pool: &PgPool,
        tenant: &str,
        child_ids: &[Uuid],
    ) -> anyhow::Result<Vec<(Uuid, String)>> {
        let schema = schema_name(tenant);
        let results: Vec<(Uuid, String)> = sqlx::query_as(&format!(
            "SELECT child_id, email FROM {schema}.child_pending_parents
             WHERE child_id = ANY($1)
             ORDER BY child_id, email"
        ))
        .bind(child_ids)
        .fetch_all(pool)
        .await?;
        Ok(results)
    }

    pub async fn list_invited_parents_for_child(
        pool: &PgPool,
        tenant: &str,
        child_id: Uuid,
    ) -> anyhow::Result<Vec<InvitedParent>> {
        let schema = schema_name(tenant);
        let invited = sqlx::query_as::<_, InvitedParent>(&format!(
            "SELECT it.email, it.role::TEXT, it.expires_at, it.created_at
             FROM {schema}.child_invitations ci
             JOIN {schema}.invitation_tokens it ON it.id = ci.invitation_token_id
             WHERE ci.child_id = $1 AND it.used = FALSE
             ORDER BY it.created_at DESC"
        ))
        .bind(child_id)
        .fetch_all(pool)
        .await?;
        Ok(invited)
    }

    pub async fn promote_invited_parents(
        pool: &PgPool,
        tenant: &str,
        user_id: Uuid,
        email: &str,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);
        // Move child_invitations to child_parents for this email's invitation token (now used)
        sqlx::query(&format!(
            "INSERT INTO {schema}.child_parents (child_id, user_id, relationship)
             SELECT ci.child_id, $1, 'parent'
             FROM {schema}.child_invitations ci
             JOIN {schema}.invitation_tokens it ON it.id = ci.invitation_token_id
             WHERE it.email = $2 AND it.used = TRUE
             ON CONFLICT (child_id, user_id) DO UPDATE SET relationship = EXCLUDED.relationship"
        ))
        .bind(user_id)
        .bind(email)
        .execute(pool)
        .await?;

        // Remove the child_invitations entries (token is marked used)
        sqlx::query(&format!(
            "DELETE FROM {schema}.child_invitations
             WHERE invitation_token_id IN (
               SELECT id FROM {schema}.invitation_tokens WHERE email = $1 AND used = TRUE
             )"
        ))
        .bind(email)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Import children from an Excel (.xlsx) or CSV file.
    /// Returns an ImportResult with counts and skipped-row errors.
    pub async fn import_from_excel(
        pool: &PgPool,
        tenant: &str,
        bytes: Vec<u8>,
        email_svc: Option<Arc<EmailService>>,
        base_url: &str,
        invited_by: Option<Uuid>,
    ) -> anyhow::Result<ImportResult> {
        // Parse all rows to Vec<Vec<String>> regardless of format
        let all_rows: Vec<Vec<String>> = if bytes.starts_with(b"PK") {
            // xlsx (ZIP-based)
            let cursor = Cursor::new(bytes);
            let mut workbook: Xlsx<_> = open_workbook_from_rs(cursor)
                .map_err(|e| anyhow::anyhow!("Impossible d'ouvrir le fichier Excel: {e}"))?;
            let sheet_names = workbook.sheet_names().to_vec();
            let sheet_name = sheet_names
                .first()
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("Le fichier ne contient aucune feuille"))?;
            let range = workbook
                .worksheet_range(&sheet_name)
                .map_err(|e| anyhow::anyhow!("Impossible de lire la feuille: {e}"))?;
            range
                .rows()
                .map(|row| row.iter().map(cell_str).collect())
                .collect()
        } else {
            // CSV (strip UTF-8 BOM if present)
            let data = if bytes.starts_with(b"\xef\xbb\xbf") { &bytes[3..] } else { &bytes[..] };
            let mut rdr = csv::ReaderBuilder::new()
                .flexible(true)
                .from_reader(data);
            let mut rows: Vec<Vec<String>> = vec![];
            // Push headers as first row
            if let Ok(headers) = rdr.headers() {
                rows.push(headers.iter().map(str::to_string).collect());
            }
            for record in rdr.records().flatten() {
                rows.push(record.iter().map(str::to_string).collect());
            }
            rows
        };

        let mut row_iter = all_rows.into_iter();

        // Read header row and build column index map
        let headers: Vec<String> = match row_iter.next() {
            Some(row) => row.iter().map(|s| s.trim().to_lowercase()).collect(),
            None => return Ok(ImportResult::default()),
        };

        fn col_idx(headers: &[String], names: &[&str]) -> Option<usize> {
            headers.iter().position(|h| names.iter().any(|n| h == n))
        }

        let idx_groupe       = col_idx(&headers, &["groupe", "group"]);
        let idx_prenom       = col_idx(&headers, &["prénom", "prenom", "first_name", "firstname"]);
        let idx_nom          = col_idx(&headers, &["nom", "last_name", "lastname"]);
        let idx_naissance    = col_idx(&headers, &["date de naissance", "birth_date", "naissance", "dob"]);
        let idx_debut        = col_idx(&headers, &["date de début", "date de debut", "start_date", "debut"]);
        let idx_jours        = col_idx(&headers, &["jours", "days", "schedule_days"]);
        let idx_parent1_email = col_idx(&headers, &["email parent 1", "email_parent1", "parent1_email", "parent 1"]);
        let idx_parent1_rel  = col_idx(&headers, &["relation parent 1", "relation_parent1", "parent1_relation"]);
        let idx_parent2_email = col_idx(&headers, &["email parent 2", "email_parent2", "parent2_email", "parent 2"]);
        let idx_parent2_rel  = col_idx(&headers, &["relation parent 2", "relation_parent2", "parent2_relation"]);
        let idx_notes        = col_idx(&headers, &["notes", "note"]);

        // Require at minimum prenom + nom + naissance columns
        if idx_prenom.is_none() || idx_nom.is_none() || idx_naissance.is_none() {
            return Err(anyhow::anyhow!(
                "Colonnes requises manquantes: Prénom, Nom et Date de naissance"
            ));
        }

        let mut result = ImportResult::default();
        // Cache: lowercase group name → Uuid
        let mut group_cache: HashMap<String, Uuid> = HashMap::new();

        for (data_row_idx, row) in row_iter.enumerate() {
            let row_num = data_row_idx + 2; // 1-indexed, header is row 1

            let get = |idx: Option<usize>| -> String {
                idx.and_then(|i| row.get(i))
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default()
            };

            let first_name = get(idx_prenom);
            let last_name  = get(idx_nom);

            if first_name.is_empty() && last_name.is_empty() {
                // Silently skip blank rows
                continue;
            }
            if first_name.is_empty() || last_name.is_empty() {
                result.skipped_rows.push(ImportRowError {
                    row: row_num,
                    reason: "Prénom ou Nom manquant".to_string(),
                });
                continue;
            }

            // Parse birth_date
            let birth_date_str = get(idx_naissance);
            let birth_date = parse_date(&birth_date_str);
            let birth_date = match birth_date {
                Some(d) => d,
                None => {
                    result.skipped_rows.push(ImportRowError {
                        row: row_num,
                        reason: format!(
                            "Date de naissance invalide: '{birth_date_str}' (attendu AAAA-MM-JJ ou JJ/MM/AAAA)"
                        ),
                    });
                    continue;
                }
            };

            // Parse optional start_date
            let start_date_str = get(idx_debut);
            let start_date = if start_date_str.is_empty() {
                None
            } else {
                parse_date(&start_date_str)
            };

            // Parse schedule_days (comma-separated ints 1–5)
            let jours_str = get(idx_jours);
            let schedule_days: Option<Vec<i32>> = if jours_str.is_empty() {
                None
            } else {
                let days: Vec<i32> = jours_str
                    .split(',')
                    .filter_map(|s| s.trim().parse::<i32>().ok())
                    .filter(|&d| (1..=7).contains(&d))
                    .collect();
                if days.is_empty() { None } else { Some(days) }
            };

            // Resolve or create group
            let groupe_name = get(idx_groupe);
            let group_id: Option<Uuid> = if groupe_name.is_empty() {
                None
            } else {
                let key = groupe_name.to_lowercase();
                if let Some(&id) = group_cache.get(&key) {
                    Some(id)
                } else {
                    // Try to find existing group (case-insensitive)
                    let schema = schema_name(tenant);
                    let existing: Option<Uuid> = sqlx::query_scalar(&format!(
                        "SELECT id FROM {schema}.groups WHERE lower(name) = lower($1) LIMIT 1"
                    ))
                    .bind(&groupe_name)
                    .fetch_optional(pool)
                    .await?;

                    let id = if let Some(id) = existing {
                        id
                    } else {
                        let g = GroupService::create(
                            pool,
                            tenant,
                            &CreateGroupRequest {
                                name: groupe_name.clone(),
                                description: None,
                                color: None,
                            },
                        )
                        .await?;
                        result.created_groups += 1;
                        g.id
                    };
                    group_cache.insert(key, id);
                    Some(id)
                }
            };

            let notes = get(idx_notes);
            let notes = if notes.is_empty() { None } else { Some(notes) };

            // Create child
            let child = ChildService::create(
                pool,
                tenant,
                &CreateChildRequest {
                    first_name,
                    last_name,
                    birth_date,
                    group_id,
                    notes,
                    start_date,
                    schedule_days,
                },
            )
            .await?;
            result.created_children += 1;

            // Add pending parents + create invitations
            let schema = schema_name(tenant);
            for (email_idx, rel_idx) in [
                (idx_parent1_email, idx_parent1_rel),
                (idx_parent2_email, idx_parent2_rel),
            ] {
                let email = get(email_idx);
                if email.is_empty() || !email.contains('@') {
                    continue;
                }
                let relationship = {
                    let r = get(rel_idx);
                    if r.is_empty() { "parent".to_string() } else { r }
                };

                // Add to pending parents (for journal delivery before registration)
                ChildService::assign_pending_parent(
                    pool,
                    tenant,
                    child.id,
                    &AssignPendingParentRequest {
                        email: email.clone(),
                        relationship: relationship.clone(),
                    },
                )
                .await?;
                result.added_pending_parents += 1;

                // Create invitation token so parent appears in "utilisateurs en attente"
                // Skip if an unused invitation already exists for this email
                let already_invited: bool = sqlx::query_scalar(&format!(
                    "SELECT EXISTS(SELECT 1 FROM {schema}.invitation_tokens WHERE email = $1 AND used = FALSE)"
                ))
                .bind(&email)
                .fetch_one(pool)
                .await
                .unwrap_or(false);

                if !already_invited {
                    use rand::Rng;
                    let token: String = rand::thread_rng()
                        .sample_iter(&rand::distributions::Alphanumeric)
                        .take(48)
                        .map(char::from)
                        .collect();
                    let expires_at = Utc::now() + chrono::Duration::days(7);

                    let inv_id: Option<Uuid> = sqlx::query_scalar(&format!(
                        "INSERT INTO {schema}.invitation_tokens (email, token, role, invited_by, expires_at)
                         VALUES ($1, $2, 'parent'::\"{schema}\".user_role, $3, $4)
                         ON CONFLICT DO NOTHING RETURNING id"
                    ))
                    .bind(&email)
                    .bind(&token)
                    .bind(invited_by)
                    .bind(expires_at)
                    .fetch_optional(pool)
                    .await
                    .unwrap_or(None);

                    if let Some(inv_id) = inv_id {
                        // Link invitation to this child
                        let _ = sqlx::query(&format!(
                            "INSERT INTO {schema}.child_invitations (child_id, invitation_token_id)
                             VALUES ($1, $2) ON CONFLICT DO NOTHING"
                        ))
                        .bind(child.id)
                        .bind(inv_id)
                        .execute(pool)
                        .await;

                        // Send invitation email if service is available (non-fatal)
                        if tenant != "demo" {
                            if let Some(ref svc) = email_svc {
                                let (garderie_name, logo_url): (String, Option<String>) =
                                    sqlx::query_as(
                                        "SELECT name, logo_url FROM public.garderies WHERE slug = $1",
                                    )
                                    .bind(tenant)
                                    .fetch_optional(pool)
                                    .await
                                    .ok()
                                    .flatten()
                                    .unwrap_or_else(|| (tenant.to_string(), None));

                                let invite_url = crate::services::auth::build_tenant_invite_url(
                                    base_url, tenant, &token,
                                );
                                let _ = svc
                                    .send_invitation(
                                        &email,
                                        &invite_url,
                                        &garderie_name,
                                        "parent",
                                        logo_url.as_deref().unwrap_or(""),
                                    )
                                    .await;
                            }
                        }

                        result.invited_parents += 1;
                    }
                }
            }
        }

        Ok(result)
    }

    /// Export all active children as CSV bytes.
    /// Format matches the import template.
    pub async fn export_all_as_csv(pool: &PgPool, tenant: &str) -> anyhow::Result<Vec<u8>> {
        let schema = schema_name(tenant);

        #[derive(sqlx::FromRow)]
        struct ExportRow {
            group_name:   Option<String>,
            first_name:   String,
            last_name:    String,
            birth_date:   NaiveDate,
            start_date:   Option<NaiveDate>,
            schedule_days: Option<Vec<i32>>,
            notes:        Option<String>,
            child_id:     Uuid,
        }

        let children: Vec<ExportRow> = sqlx::query_as(&format!(
            "SELECT g.name as group_name, c.first_name, c.last_name, c.birth_date,
                    c.start_date, c.schedule_days, c.notes, c.id as child_id
             FROM {schema}.children c
             LEFT JOIN {schema}.groups g ON g.id = c.group_id
             WHERE c.is_active = TRUE
             ORDER BY g.name NULLS LAST, c.last_name, c.first_name"
        ))
        .fetch_all(pool)
        .await?;

        // Gather pending parents for all children
        let child_ids: Vec<Uuid> = children.iter().map(|c| c.child_id).collect();
        let pending: Vec<(Uuid, String, String)> = if child_ids.is_empty() {
            vec![]
        } else {
            sqlx::query_as(&format!(
                "SELECT child_id, email, relationship
                 FROM {schema}.child_pending_parents
                 WHERE child_id = ANY($1)
                 ORDER BY child_id, created_at"
            ))
            .bind(&child_ids)
            .fetch_all(pool)
            .await?
        };

        // Map child_id → list of (email, relationship)
        let mut pending_map: HashMap<Uuid, Vec<(String, String)>> = HashMap::new();
        for (cid, email, rel) in pending {
            pending_map.entry(cid).or_default().push((email, rel));
        }

        let mut wtr = csv::WriterBuilder::new().from_writer(Vec::new());
        wtr.write_record([
            "Groupe",
            "Prénom",
            "Nom",
            "Date de naissance",
            "Date de début",
            "Jours (1=Lun…5=Ven)",
            "Email parent 1",
            "Relation parent 1",
            "Email parent 2",
            "Relation parent 2",
            "Notes",
        ])?;

        for c in &children {
            let parents = pending_map.get(&c.child_id).cloned().unwrap_or_default();
            let p1 = parents.first().cloned().unwrap_or_default();
            let p2 = parents.get(1).cloned().unwrap_or_default();

            let days_str = c
                .schedule_days
                .as_ref()
                .map(|d| d.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(","))
                .unwrap_or_default();

            wtr.write_record([
                c.group_name.as_deref().unwrap_or(""),
                &c.first_name,
                &c.last_name,
                &c.birth_date.format("%Y-%m-%d").to_string(),
                &c.start_date.map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default(),
                &days_str,
                &p1.0,
                &p1.1,
                &p2.0,
                &p2.1,
                c.notes.as_deref().unwrap_or(""),
            ])?;
        }

        let data = wtr.into_inner().map_err(|e| anyhow::anyhow!("Erreur CSV: {e}"))?;
        Ok(data)
    }

    pub async fn assign_invited_parent(
        pool: &PgPool,
        tenant: &str,
        child_id: Uuid,
        invitation_token_id: Uuid,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);
        sqlx::query(&format!(
            "INSERT INTO {schema}.child_invitations (child_id, invitation_token_id)
             VALUES ($1, $2)
             ON CONFLICT (child_id, invitation_token_id) DO NOTHING"
        ))
        .bind(child_id)
        .bind(invitation_token_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn remove_invited_parent(
        pool: &PgPool,
        tenant: &str,
        child_id: Uuid,
        invitation_token_id: Uuid,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);
        sqlx::query(&format!(
            "DELETE FROM {schema}.child_invitations WHERE child_id = $1 AND invitation_token_id = $2"
        ))
        .bind(child_id)
        .bind(invitation_token_id)
        .execute(pool)
        .await?;
        Ok(())
    }
}

impl Default for crate::models::child::ImportResult {
    fn default() -> Self {
        Self {
            created_groups: 0,
            created_children: 0,
            added_pending_parents: 0,
            invited_parents: 0,
            skipped_rows: vec![],
        }
    }
}

/// Convert a calamine cell value to a plain string.
fn cell_str(cell: &Data) -> String {
    match cell {
        Data::String(s) | Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
        Data::DateTime(edt) => {
            // ExcelDateTime → NaiveDateTime via calamine's own conversion
            edt.as_datetime()
                .map(|dt| dt.date().format("%Y-%m-%d").to_string())
                .unwrap_or_default()
        }
        Data::Float(f) => {
            if f.fract() == 0.0 {
                format!("{}", *f as i64)
            } else {
                f.to_string()
            }
        }
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        Data::Error(_) | Data::Empty => String::new(),
    }
}


/// Try to parse a date string in YYYY-MM-DD or DD/MM/YYYY format.
fn parse_date(s: &str) -> Option<NaiveDate> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    // Try ISO format
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(d);
    }
    // Try DD/MM/YYYY
    if let Ok(d) = NaiveDate::parse_from_str(s, "%d/%m/%Y") {
        return Some(d);
    }
    // Try MM/DD/YYYY
    if let Ok(d) = NaiveDate::parse_from_str(s, "%m/%d/%Y") {
        return Some(d);
    }
    None
}
