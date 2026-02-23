-- Encryption columns are managed per-tenant via provision_tenant_schema().
-- media and documents tables live in garderie_{slug} schemas, not public.
-- This migration is intentionally a no-op.
DO $$ BEGIN END $$;
