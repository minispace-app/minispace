-- Consent records for garderie admin signups (Loi 25 compliance)
-- Tracks: privacy policy acceptance + parents commitment acceptance

CREATE TABLE IF NOT EXISTS public.consent_records (
    id                           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type                  VARCHAR(32) NOT NULL,   -- 'garderie_signup'
    entity_id                    UUID        NOT NULL,   -- garderie id
    privacy_accepted             BOOLEAN     NOT NULL DEFAULT TRUE,
    parents_commitment_accepted  BOOLEAN,
    accepted_at                  TIMESTAMPTZ NOT NULL,
    policy_version               VARCHAR(32) NOT NULL,
    language                     VARCHAR(8)  NOT NULL DEFAULT 'fr',
    ip_address                   VARCHAR(64),
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS consent_records_entity_idx
    ON public.consent_records (entity_type, entity_id);
