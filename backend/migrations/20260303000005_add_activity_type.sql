-- Add type column to activities tables (theme | sortie)

DO $$
DECLARE
  slug_row RECORD;
  schema TEXT;
BEGIN
  FOR slug_row IN SELECT slug FROM public.garderies WHERE is_active = true
  LOOP
    schema := 'garderie_' || replace(slug_row.slug, '-', '_');

    -- Add type column with default 'sortie' (existing activities keep working)
    EXECUTE format('ALTER TABLE %I.activities ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT ''sortie''', schema);
  END LOOP;
END;
$$;
