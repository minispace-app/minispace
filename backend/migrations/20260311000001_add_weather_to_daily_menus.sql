-- Add weather column to daily_menus for all existing tenant schemas
-- Weather is garderie-wide (same for all children on a given day)
-- This replaces the per-child temperature field in daily_journals

DO $$
DECLARE
  garderie_slug TEXT;
BEGIN
  FOR garderie_slug IN SELECT slug FROM public.garderies LOOP
    EXECUTE format(
      'ALTER TABLE "garderie_%s".daily_menus ADD COLUMN IF NOT EXISTS weather "garderie_%s".weather_condition',
      garderie_slug, garderie_slug
    );
  END LOOP;
END $$;
