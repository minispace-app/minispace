-- Audit log per tenant (Loi 25 compliance + security traceability)
-- Records sensitive actions: logins, child/user CRUD, media, documents

DO $$
DECLARE
    r RECORD;
    s TEXT;
BEGIN
    FOR r IN SELECT slug FROM public.garderies LOOP
        s := 'garderie_' || replace(r.slug, '-', '_');
        EXECUTE format($fmt$
            CREATE TABLE IF NOT EXISTS %I.audit_log (
                id             UUID        PRIMARY KEY DEFAULT public.uuid_generate_v4(),
                user_id        UUID        REFERENCES %I.users(id) ON DELETE SET NULL,
                user_name      TEXT,
                action         TEXT        NOT NULL,
                resource_type  TEXT,
                resource_id    TEXT,
                resource_label TEXT,
                ip_address     VARCHAR(64),
                created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS audit_log_created_at_idx_%s ON %I.audit_log (created_at DESC);
            CREATE INDEX IF NOT EXISTS audit_log_user_id_idx_%s    ON %I.audit_log (user_id);
        $fmt$, s, s,
               replace(r.slug, '-', '_'), s,
               replace(r.slug, '-', '_'), s);
    END LOOP;
END;
$$;
