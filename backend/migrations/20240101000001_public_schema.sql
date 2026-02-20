-- Public schema: garderies (tenants) and super admins

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE plan_type AS ENUM ('free', 'standard', 'premium');

CREATE TABLE IF NOT EXISTS garderies (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug        VARCHAR(64) UNIQUE NOT NULL,
    name        VARCHAR(255) NOT NULL,
    address     TEXT,
    phone       VARCHAR(32),
    email       VARCHAR(255),
    logo_url    TEXT,
    plan        plan_type NOT NULL DEFAULT 'free',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS super_admins (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    first_name    VARCHAR(128) NOT NULL,
    last_name     VARCHAR(128) NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER garderies_updated_at
    BEFORE UPDATE ON garderies
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER super_admins_updated_at
    BEFORE UPDATE ON super_admins
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
