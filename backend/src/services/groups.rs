use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
    models::group::{CreateGroupRequest, Group, UpdateGroupRequest},
};

pub struct GroupService;

impl GroupService {
    pub async fn list(pool: &PgPool, tenant: &str) -> anyhow::Result<Vec<Group>> {
        let schema = schema_name(tenant);
        let groups = sqlx::query_as::<_, Group>(&format!(
            "SELECT * FROM {schema}.groups ORDER BY name"
        ))
        .fetch_all(pool)
        .await?;
        Ok(groups)
    }

    pub async fn create(
        pool: &PgPool,
        tenant: &str,
        req: &CreateGroupRequest,
    ) -> anyhow::Result<Group> {
        let schema = schema_name(tenant);
        let group = sqlx::query_as::<_, Group>(&format!(
            "INSERT INTO {schema}.groups (name, description, color)
             VALUES ($1, $2, $3)
             RETURNING *"
        ))
        .bind(&req.name)
        .bind(&req.description)
        .bind(&req.color)
        .fetch_one(pool)
        .await?;
        Ok(group)
    }

    pub async fn update(
        pool: &PgPool,
        tenant: &str,
        id: Uuid,
        req: &UpdateGroupRequest,
    ) -> anyhow::Result<Group> {
        let schema = schema_name(tenant);
        let group = sqlx::query_as::<_, Group>(&format!(
            "UPDATE {schema}.groups
             SET name = COALESCE($1, name),
                 description = COALESCE($2, description),
                 color = COALESCE($3, color)
             WHERE id = $4
             RETURNING *"
        ))
        .bind(&req.name)
        .bind(&req.description)
        .bind(&req.color)
        .bind(id)
        .fetch_one(pool)
        .await?;
        Ok(group)
    }

    pub async fn delete(pool: &PgPool, tenant: &str, id: Uuid) -> anyhow::Result<()> {
        let schema = schema_name(tenant);
        sqlx::query(&format!("DELETE FROM {schema}.groups WHERE id = $1"))
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Replace the children list for a group: detach all current children,
    /// then attach the provided ones.
    pub async fn set_children(
        pool: &PgPool,
        tenant: &str,
        id: Uuid,
        child_ids: &[Uuid],
    ) -> anyhow::Result<()> {
        let schema = schema_name(tenant);
        // Detach all children currently in this group
        sqlx::query(&format!(
            "UPDATE {schema}.children SET group_id = NULL WHERE group_id = $1"
        ))
        .bind(id)
        .execute(pool)
        .await?;
        // Attach the new list
        if !child_ids.is_empty() {
            sqlx::query(&format!(
                "UPDATE {schema}.children SET group_id = $1 WHERE id = ANY($2)"
            ))
            .bind(id)
            .bind(child_ids)
            .execute(pool)
            .await?;
        }
        Ok(())
    }
}
