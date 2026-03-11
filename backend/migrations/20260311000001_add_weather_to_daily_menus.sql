-- Add weather column to daily_menus for all existing tenant schemas
-- Weather is garderie-wide (same for all children on a given day)
-- This replaces the per-child temperature field in daily_journals

DO $$
DECLARE
  schema_rec RECORD;
BEGIN
  FOR schema_rec IN
    SELECT schema_name FROM public.tenants
  LOOP
    EXECUTE format(
      'ALTER TABLE "garderie_%s".daily_menus ADD COLUMN IF NOT EXISTS weather "garderie_%s".weather_condition',
      schema_rec.schema_name, schema_rec.schema_name
    );
  END LOOP;
END $$;
