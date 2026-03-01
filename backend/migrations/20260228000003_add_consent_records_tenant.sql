-- Consent records for parent registrations (per-tenant, Loi 25 compliance)
-- Tracks: privacy policy acceptance + photo sharing authorization
-- Also adds the table to provision_tenant_schema for new tenants (see db/tenant.rs)

DO $$
DECLARE
    r RECORD;
    s TEXT;
BEGIN
    FOR r IN SELECT slug FROM public.garderies LOOP
        s := 'garderie_' || replace(r.slug, '-', '_');
        EXECUTE format($fmt$
            CREATE TABLE IF NOT EXISTS %I.consent_records (
                id               UUID        PRIMARY KEY DEFAULT public.uuid_generate_v4(),
                user_id          UUID        NOT NULL REFERENCES %I.users(id) ON DELETE CASCADE,
                privacy_accepted BOOLEAN     NOT NULL DEFAULT TRUE,
                photos_accepted  BOOLEAN     NOT NULL DEFAULT FALSE,
                accepted_at      TIMESTAMPTZ NOT NULL,
                policy_version   VARCHAR(32) NOT NULL,
                language         VARCHAR(8)  NOT NULL DEFAULT ''fr'',
                ip_address       VARCHAR(64),
                created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        $fmt$, s, s);
    END LOOP;
END;
$$;
