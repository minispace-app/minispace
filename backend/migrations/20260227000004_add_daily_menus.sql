-- Create daily_menus table in all existing active tenant schemas
DO $$
DECLARE
  slug_row RECORD;
  schema TEXT;
BEGIN
  FOR slug_row IN
    SELECT slug FROM public.garderies WHERE is_active = true
  LOOP
    schema := 'garderie_' || replace(slug_row.slug, '-', '_');

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.daily_menus (
          id         UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
          date       DATE NOT NULL UNIQUE,
          menu       TEXT NOT NULL,
          created_by UUID NOT NULL REFERENCES %I.users(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )',
      schema, schema
    );

    EXECUTE format(
      'DROP TRIGGER IF EXISTS daily_menus_updated_at ON %I.daily_menus;
       CREATE TRIGGER daily_menus_updated_at
       BEFORE UPDATE ON %I.daily_menus
       FOR EACH ROW EXECUTE FUNCTION %I.update_updated_at()',
      schema, schema, schema
    );
  END LOOP;
END;
$$;
