-- Activities and activity registrations (per-tenant)
-- Admins create activities with optional capacity limits
-- Parents and staff can register children to activities

DO $$
DECLARE
    r RECORD;
    s TEXT;
BEGIN
    FOR r IN SELECT slug FROM public.garderies LOOP
        s := 'garderie_' || replace(r.slug, '-', '_');

        EXECUTE format($fmt$
            CREATE TABLE IF NOT EXISTS %I.activities (
                id           UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
                title        VARCHAR(255) NOT NULL,
                description  TEXT,
                date         DATE NOT NULL,
                capacity     INT,
                created_by   UUID NOT NULL REFERENCES %I.users(id) ON DELETE CASCADE,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        $fmt$, s, s);

        EXECUTE format($fmt$
            CREATE TABLE IF NOT EXISTS %I.activity_registrations (
                id            UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
                activity_id   UUID NOT NULL REFERENCES %I.activities(id) ON DELETE CASCADE,
                child_id      UUID NOT NULL REFERENCES %I.children(id) ON DELETE CASCADE,
                registered_by UUID NOT NULL REFERENCES %I.users(id) ON DELETE CASCADE,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (activity_id, child_id)
            )
        $fmt$, s, s, s, s);

        EXECUTE format($fmt$
            CREATE INDEX IF NOT EXISTS act_reg_activity_idx ON %I.activity_registrations(activity_id)
        $fmt$, s);
    END LOOP;
END;
$$;
