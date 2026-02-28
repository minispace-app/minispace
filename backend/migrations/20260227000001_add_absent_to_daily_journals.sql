-- Add absent flag to daily_journals for all existing tenant schemas
DO $$
DECLARE
  garderie_slug TEXT;
BEGIN
  FOR garderie_slug IN SELECT slug FROM public.garderies LOOP
    EXECUTE format(
      'ALTER TABLE "garderie_%s".daily_journals ADD COLUMN IF NOT EXISTS absent BOOLEAN NOT NULL DEFAULT FALSE',
      garderie_slug
    );
  END LOOP;
END;
$$;
