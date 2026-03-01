-- Add retention tracking columns for data purging based on privacy policy
-- Policy: https://minispace.app/confidentialite
-- Retention periods:
--   - Children data: attendance + 1 year
--   - Photos/media: attendance + 6 months
--   - Messages: attendance + 2 years
--   - Admin/financial: attendance + 7 years
--   - Audit logs: 90 days
--   - Technical logs: 90 days

-- When a child is marked inactive (is_active=FALSE), purge job will:
-- 1. Calculate retention expiry dates based on deactivation timestamp
-- 2. Hard-delete data after retention period expires

-- Public garderies table: track when each garderie was created (already has created_at)
-- No new columns needed for garderies.

-- Per-tenant tables: add is_deleted + deleted_at columns for soft-delete tracking
-- Retention purge happens via cron job: minispace_api::cron::purge_expired_data()

-- Note: This migration is idempotent - ADD COLUMN IF NOT EXISTS
-- Existing data will have is_deleted = FALSE

ALTER TABLE IF EXISTS "{schema}".children
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS "{schema}".media
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS "{schema}".messages
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS "{schema}".documents
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS "{schema}".audit_log
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Add indexes for retention purge queries
CREATE INDEX IF NOT EXISTS children_deleted_at_idx ON "{schema}".children(deleted_at) WHERE is_deleted = TRUE;
CREATE INDEX IF NOT EXISTS media_deleted_at_idx ON "{schema}".media(deleted_at) WHERE is_deleted = TRUE;
CREATE INDEX IF NOT EXISTS messages_deleted_at_idx ON "{schema}".messages(deleted_at) WHERE is_deleted = TRUE;
CREATE INDEX IF NOT EXISTS documents_deleted_at_idx ON "{schema}".documents(deleted_at) WHERE is_deleted = TRUE;
CREATE INDEX IF NOT EXISTS audit_log_deleted_at_idx ON "{schema}".audit_log(deleted_at) WHERE is_deleted = TRUE;
