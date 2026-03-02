-- Add child schedule fields: start_date and schedule_days (days of week 1=Mon..5=Fri)
-- NULL schedule_days means full week (Mon-Fri), same as {1,2,3,4,5}

DO $$
DECLARE
    r RECORD;
    s TEXT;
BEGIN
    FOR r IN SELECT slug FROM public.garderies LOOP
        s := 'garderie_' || replace(r.slug, '-', '_');

        EXECUTE format($fmt$
            ALTER TABLE %I.children
                ADD COLUMN IF NOT EXISTS start_date    DATE,
                ADD COLUMN IF NOT EXISTS schedule_days INTEGER[]
        $fmt$, s);
    END LOOP;
END;
$$;
