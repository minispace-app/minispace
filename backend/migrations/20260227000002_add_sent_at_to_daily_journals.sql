-- Add sent_at to track automatic journal sends per entry
DO $$
DECLARE
  garderie_slug TEXT;
BEGIN
  FOR garderie_slug IN SELECT slug FROM public.garderies LOOP
    EXECUTE format(
      'ALTER TABLE "garderie_%s".daily_journals ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ',
      garderie_slug
    );
  END LOOP;
END;
$$;
