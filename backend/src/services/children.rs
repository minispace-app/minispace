use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
    models::child::{AssignParentRequest, AssignPendingParentRequest, Child, ChildParentUser, CreateChildRequest, PendingParent, UpdateChildRequest},
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
}
