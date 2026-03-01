use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
    models::child::{AssignParentRequest, Child, ChildParentUser, CreateChildRequest, UpdateChildRequest},
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
            "INSERT INTO {schema}.children (first_name, last_name, birth_date, group_id, notes)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *"
        ))
        .bind(&req.first_name)
        .bind(&req.last_name)
        .bind(req.birth_date)
        .bind(req.group_id)
        .bind(&req.notes)
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
             SET first_name = COALESCE($1, first_name),
                 last_name  = COALESCE($2, last_name),
                 birth_date = COALESCE($3, birth_date),
                 group_id   = COALESCE($4, group_id),
                 notes      = COALESCE($5, notes),
                 is_active  = COALESCE($6, is_active)
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

    /// Hard-delete a child and all associated data (Law 25 compliance - right to be forgotten).
    ///
    /// Deletion strategy (respects multi-child photos):
    /// 1. Delete single-child media (child_id = this child)
    /// 2. Remove this child from multi-child media (via media_children junction)
    /// 3. Delete daily journals for this child
    /// 4. Delete documents for this child
    /// 5. Hard-delete child record (FK cascades handle child_parents)
    pub async fn delete(
        pool: &PgPool,
        tenant: &str,
        child_id: Uuid,
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);

        // Step 1: Identify and delete single-child media (media.child_id = this child)
        // These media have ONLY this child, so they should be deleted entirely
        sqlx::query(&format!(
            "DELETE FROM {schema}.media WHERE child_id = $1"
        ))
        .bind(child_id)
        .execute(pool)
        .await?;

        // Step 2: Remove this child from multi-child media (media_children junction)
        // The media remains but this child's tag is removed (right to be forgotten)
        sqlx::query(&format!(
            "DELETE FROM {schema}.media_children WHERE child_id = $1"
        ))
        .bind(child_id)
        .execute(pool)
        .await?;

        // Step 3: Delete daily journals for this child
        sqlx::query(&format!(
            "DELETE FROM {schema}.daily_journals WHERE child_id = $1"
        ))
        .bind(child_id)
        .execute(pool)
        .await?;

        // Step 4: Delete documents for this child
        sqlx::query(&format!(
            "DELETE FROM {schema}.documents WHERE child_id = $1"
        ))
        .bind(child_id)
        .execute(pool)
        .await?;

        // Step 5: Hard-delete the child (FK CASCADE will handle child_parents)
        sqlx::query(&format!(
            "DELETE FROM {schema}.children WHERE id = $1"
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
}
