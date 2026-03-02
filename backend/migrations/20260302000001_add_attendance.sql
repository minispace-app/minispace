-- Attendance tracking for children (per-tenant)
-- Tracks daily attendance status: expected, present, absent, sick, vacation, contract-outside

DO $$
DECLARE
    r RECORD;
    s TEXT;
BEGIN
    FOR r IN SELECT slug FROM public.garderies LOOP
        s := 'garderie_' || replace(r.slug, '-', '_');
        EXECUTE format($fmt$
            CREATE TYPE %I.attendance_status AS ENUM (
                'attendu',
                'present',
                'absent',
                'malade',
                'vacances',
                'present_hors_contrat'
            )
        $fmt$, s);

        EXECUTE format($fmt$
            CREATE TABLE IF NOT EXISTS %I.attendance (
                id          UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
                child_id    UUID NOT NULL REFERENCES %I.children(id) ON DELETE CASCADE,
                date        DATE NOT NULL,
                status      %I.attendance_status NOT NULL DEFAULT 'attendu',
                marked_by   UUID REFERENCES %I.users(id) ON DELETE SET NULL,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (child_id, date)
            )
        $fmt$, s, s, s, s);

        EXECUTE format($fmt$
            CREATE INDEX IF NOT EXISTS attendance_child_date_idx ON %I.attendance(child_id, date)
        $fmt$, s);
    END LOOP;
END;
$$;
