-- Split menu into 3 sections: collation_matin, diner, collation_apres_midi
DO $$
DECLARE
  slug_row RECORD;
  schema TEXT;
BEGIN
  FOR slug_row IN
    SELECT slug FROM public.garderies WHERE is_active = true
  LOOP
    schema := 'garderie_' || replace(slug_row.slug, '-', '_');

    -- Add new columns if they don't exist
    EXECUTE format(
      'ALTER TABLE %I.daily_menus
       ADD COLUMN IF NOT EXISTS collation_matin TEXT,
       ADD COLUMN IF NOT EXISTS diner TEXT,
       ADD COLUMN IF NOT EXISTS collation_apres_midi TEXT',
      schema
    );

  END LOOP;
END;
$$;
