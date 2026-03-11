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
            r#"SELECT id, date, weather::TEXT AS weather, menu, collation_matin, diner, collation_apres_midi,
                      created_by, created_at, updated_at
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
            r#"INSERT INTO "{schema}".daily_menus (date, weather, menu, collation_matin, diner, collation_apres_midi, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (date) DO UPDATE SET
                   weather = COALESCE(EXCLUDED.weather, daily_menus.weather),
                   menu = COALESCE(EXCLUDED.menu, daily_menus.menu),
                   collation_matin = COALESCE(EXCLUDED.collation_matin, daily_menus.collation_matin),
                   diner = COALESCE(EXCLUDED.diner, daily_menus.diner),
                   collation_apres_midi = COALESCE(EXCLUDED.collation_apres_midi, daily_menus.collation_apres_midi),
                   updated_at = NOW()
               RETURNING id, date, weather::TEXT AS weather, menu, collation_matin, diner, collation_apres_midi, created_by, created_at, updated_at"#
        ))
        .bind(req.date)
        .bind(&req.weather)
        .bind(&req.menu)
        .bind(&req.collation_matin)
        .bind(&req.diner)
        .bind(&req.collation_apres_midi)
        .bind(created_by)
        .fetch_one(pool)
        .await?;
        Ok(entry)
    }
}
