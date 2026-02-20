-- Tenant schema template — executed once per garderie at provisioning time
-- Replace :schema with the actual schema name (e.g. garderie_abc)

-- This file serves as documentation of the per-tenant schema structure.
-- The actual schema creation is done dynamically in the Rust code using
-- db::tenant::provision_tenant_schema().

/*
SCHEMA garderie_{slug}

Tables:
  users           -- admins, éducateurs, parents of this garderie
  refresh_tokens  -- JWT refresh tokens (revocable)
  invitation_tokens
  groups          -- poupons, bambins, etc.
  children
  child_parents   -- many-to-many children <-> parents
  messages
  message_attachments
  media
  documents
  push_tokens     -- FCM / APNS tokens per user
*/
