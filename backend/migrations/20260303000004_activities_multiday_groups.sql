-- Add end_date and group_id columns to activities tables

DO $$
DECLARE
  slug_row RECORD;
  schema TEXT;
BEGIN
  FOR slug_row IN SELECT slug FROM public.garderies WHERE is_active = true
  LOOP
    schema := 'garderie_' || replace(slug_row.slug, '-', '_');

    -- Add end_date column
    EXECUTE format('ALTER TABLE %I.activities ADD COLUMN IF NOT EXISTS end_date DATE', schema);

    -- Add group_id column with foreign key
    EXECUTE format('ALTER TABLE %I.activities ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES %I.groups(id) ON DELETE SET NULL', schema, schema);

    -- Create indexes for better query performance
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_activities_end_date ON %I.activities(end_date)', schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_activities_group_id ON %I.activities(group_id)', schema);
  END LOOP;
END;
$$;
