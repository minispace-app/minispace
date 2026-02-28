use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    db::tenant::schema_name,
    models::menu::{DailyMenu, UpsertMenuRequest},
};

pub struct MenuService;

impl MenuService {
    /// Fetch all garderie-level menu entries between Monday and Friday of the given week.
    pub async fn list_week(
        pool: &PgPool,
        tenant: &str,
        week_start: NaiveDate,
    ) -> anyhow::Result<Vec<DailyMenu>> {
        let schema = schema_name(tenant);
        let week_end = week_start + chrono::Duration::days(4);
        let entries = sqlx::query_as::<_, DailyMenu>(&format!(
            r#"SELECT id, date, menu, created_by, created_at, updated_at
               FROM "{schema}".daily_menus
               WHERE date BETWEEN $1 AND $2
               ORDER BY date"#
        ))
        .bind(week_start)
        .bind(week_end)
        .fetch_all(pool)
        .await?;
        Ok(entries)
    }

    /// Insert or update the garderie-level menu for a specific date.
    pub async fn upsert(
        pool: &PgPool,
        tenant: &str,
        req: &UpsertMenuRequest,
        created_by: Uuid,
    ) -> anyhow::Result<DailyMenu> {
        let schema = schema_name(tenant);
        let entry = sqlx::query_as::<_, DailyMenu>(&format!(
            r#"INSERT INTO "{schema}".daily_menus (date, menu, created_by)
               VALUES ($1, $2, $3)
               ON CONFLICT (date) DO UPDATE SET
                   menu = EXCLUDED.menu,
                   updated_at = NOW()
               RETURNING id, date, menu, created_by, created_at, updated_at"#
        ))
        .bind(req.date)
        .bind(&req.menu)
        .bind(created_by)
        .fetch_one(pool)
        .await?;
        Ok(entry)
    }
}
