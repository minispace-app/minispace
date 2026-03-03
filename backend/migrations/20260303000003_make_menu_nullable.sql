-- Make menu column nullable in daily_menus (deprecated in favor of structured fields)
DO $$
DECLARE
  slug_row RECORD;
  schema TEXT;
BEGIN
  FOR slug_row IN
    SELECT slug FROM public.garderies WHERE is_active = true
  LOOP
    schema := 'garderie_' || replace(slug_row.slug, '-', '_');

    EXECUTE format('ALTER TABLE %I.daily_menus ALTER COLUMN menu DROP NOT NULL', schema);
  END LOOP;
END;
$$;
