-- Global announcements (displayed as a banner to all users)

CREATE TABLE IF NOT EXISTS announcements (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message    TEXT NOT NULL,
    color      VARCHAR(16) NOT NULL DEFAULT 'yellow',
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER announcements_updated_at
    BEFORE UPDATE ON announcements
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
