use sqlx::PgPool;

/// Provision a new per-tenant PostgreSQL schema with all required tables.
/// Called when a new garderie is created.
pub async fn provision_tenant_schema(pool: &PgPool, slug: &str) -> anyhow::Result<()> {
    let schema = schema_name(slug);

    // --- Create schema ---
    sqlx::raw_sql(&format!("CREATE SCHEMA IF NOT EXISTS \"{schema}\""))
        .execute(pool)
        .await?;

    // --- Enum: user_role ---
    sqlx::raw_sql(&format!(
        "DO $$ BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'user_role' AND n.nspname = '{schema}'
           ) THEN
             CREATE TYPE \"{schema}\".user_role AS ENUM
               ('super_admin','admin_garderie','educateur','parent');
           END IF;
         END $$"
    ))
    .execute(pool)
    .await?;

    // --- Users ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".users (
            id               UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
            email            VARCHAR(255) UNIQUE NOT NULL,
            password_hash    TEXT NOT NULL,
            first_name       VARCHAR(128) NOT NULL,
            last_name        VARCHAR(128) NOT NULL,
            role             "{schema}".user_role NOT NULL DEFAULT 'parent',
            avatar_url       TEXT,
            is_active        BOOLEAN NOT NULL DEFAULT TRUE,
            force_password_change BOOLEAN NOT NULL DEFAULT FALSE,
            preferred_locale VARCHAR(8) NOT NULL DEFAULT 'fr',
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#
    ))
    .execute(pool)
    .await?;

    // Ensure the column exists for existing tenant schemas (idempotent)
    sqlx::raw_sql(&format!(
        r#"ALTER TABLE "{schema}".users ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN NOT NULL DEFAULT FALSE"#
    ))
    .execute(pool)
    .await?;

    // --- Refresh tokens ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".refresh_tokens (
            id           UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
            user_id      UUID NOT NULL REFERENCES "{schema}".users(id) ON DELETE CASCADE,
            token_hash   TEXT NOT NULL,
            expires_at   TIMESTAMPTZ NOT NULL,
            revoked      BOOLEAN NOT NULL DEFAULT FALSE,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#
    ))
    .execute(pool)
    .await?;

    // --- Invitation tokens ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".invitation_tokens (
            id           UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
            email        VARCHAR(255) NOT NULL,
            token        TEXT UNIQUE NOT NULL,
            role         "{schema}".user_role NOT NULL DEFAULT 'parent',
            invited_by   UUID REFERENCES "{schema}".users(id),
            used         BOOLEAN NOT NULL DEFAULT FALSE,
            expires_at   TIMESTAMPTZ NOT NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#
    ))
    .execute(pool)
    .await?;

    // Make invited_by nullable for existing tenant schemas (super-admin invitations)
    sqlx::raw_sql(&format!(
        r#"ALTER TABLE "{schema}".invitation_tokens ALTER COLUMN invited_by DROP NOT NULL"#
    ))
    .execute(pool)
    .await?;

    // --- Groups ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".groups (
            id          UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
            name        VARCHAR(128) NOT NULL,
            description TEXT,
            color       VARCHAR(16),
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#
    ))
    .execute(pool)
    .await?;

    // --- Children ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".children (
            id          UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
            first_name  VARCHAR(128) NOT NULL,
            last_name   VARCHAR(128) NOT NULL,
            birth_date  DATE NOT NULL,
            photo_url   TEXT,
            group_id    UUID REFERENCES "{schema}".groups(id) ON DELETE SET NULL,
            notes       TEXT,
            is_active   BOOLEAN NOT NULL DEFAULT TRUE,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#
    ))
    .execute(pool)
    .await?;

    // Idempotent: fix existing FK to use ON DELETE SET NULL instead of RESTRICT
    sqlx::raw_sql(&format!(
        r#"ALTER TABLE "{schema}".children
           DROP CONSTRAINT IF EXISTS children_group_id_fkey;
           ALTER TABLE "{schema}".children
           ADD CONSTRAINT children_group_id_fkey
             FOREIGN KEY (group_id) REFERENCES "{schema}".groups(id) ON DELETE SET NULL"#
    ))
    .execute(pool)
    .await?;

    // --- Child–parent link ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".child_parents (
            child_id     UUID NOT NULL REFERENCES "{schema}".children(id) ON DELETE CASCADE,
            user_id      UUID NOT NULL REFERENCES "{schema}".users(id)    ON DELETE CASCADE,
            relationship VARCHAR(64) NOT NULL DEFAULT 'parent',
            PRIMARY KEY (child_id, user_id)
        )"#
    ))
    .execute(pool)
    .await?;

    // --- Enum: message_type ---
    sqlx::raw_sql(&format!(
        "DO $$ BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'message_type' AND n.nspname = '{schema}'
           ) THEN
             CREATE TYPE \"{schema}\".message_type AS ENUM
               ('broadcast','group','individual');
           END IF;
         END $$"
    ))
    .execute(pool)
    .await?;

    // --- Enum: send_to_parents_scope ---
    sqlx::raw_sql(&format!(
        "DO $$ BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'send_to_parents_scope' AND n.nspname = '{schema}'
           ) THEN
             CREATE TYPE \"{schema}\".send_to_parents_scope AS ENUM
               ('all_parents','child_parents','group_parents');
           END IF;
         END $$"
    ))
    .execute(pool)
    .await?;

    // --- Messages ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".messages (
            id                      UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
            sender_id               UUID NOT NULL REFERENCES "{schema}".users(id),
            message_type            "{schema}".message_type NOT NULL DEFAULT 'broadcast',
            group_id                UUID REFERENCES "{schema}".groups(id),
            recipient_id            UUID REFERENCES "{schema}".users(id),
            content                 TEXT NOT NULL,
            is_read                 BOOLEAN NOT NULL DEFAULT FALSE,
            subject                 VARCHAR(255),
            send_to_parents_scope   "{schema}".send_to_parents_scope,
            send_to_parents_child   UUID REFERENCES "{schema}".children(id) ON DELETE SET NULL,
            send_to_parents_group   UUID REFERENCES "{schema}".groups(id) ON DELETE SET NULL,
            email_sent              BOOLEAN NOT NULL DEFAULT FALSE,
            created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#
    ))
    .execute(pool)
    .await?;

    // --- Ensure columns exist for existing schemas (idempotent) ---
    sqlx::raw_sql(&format!(
        r#"ALTER TABLE "{schema}".messages ADD COLUMN IF NOT EXISTS subject VARCHAR(255);
           ALTER TABLE "{schema}".messages ADD COLUMN IF NOT EXISTS send_to_parents_scope "{schema}".send_to_parents_scope;
           ALTER TABLE "{schema}".messages ADD COLUMN IF NOT EXISTS send_to_parents_child UUID REFERENCES "{schema}".children(id) ON DELETE SET NULL;
           ALTER TABLE "{schema}".messages ADD COLUMN IF NOT EXISTS send_to_parents_group UUID REFERENCES "{schema}".groups(id) ON DELETE SET NULL;
           ALTER TABLE "{schema}".messages ADD COLUMN IF NOT EXISTS email_sent BOOLEAN NOT NULL DEFAULT FALSE"#
    ))
    .execute(pool)
    .await?;

    sqlx::raw_sql(&format!(
        r#"CREATE INDEX IF NOT EXISTS messages_sender_idx    ON "{schema}".messages(sender_id);
           CREATE INDEX IF NOT EXISTS messages_group_idx     ON "{schema}".messages(group_id);
           CREATE INDEX IF NOT EXISTS messages_recipient_idx ON "{schema}".messages(recipient_id);
           CREATE INDEX IF NOT EXISTS messages_created_idx   ON "{schema}".messages(created_at DESC)"#
    ))
    .execute(pool)
    .await?;

    // --- Message attachments ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".message_attachments (
            id          UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
            message_id  UUID NOT NULL REFERENCES "{schema}".messages(id) ON DELETE CASCADE,
            media_id    UUID,
            document_id UUID
        )"#
    ))
    .execute(pool)
    .await?;

    // --- Enum: media_type ---
    sqlx::raw_sql(&format!(
        "DO $$ BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'media_type' AND n.nspname = '{schema}'
           ) THEN
             CREATE TYPE \"{schema}\".media_type AS ENUM ('photo','video');
           END IF;
         END $$"
    ))
    .execute(pool)
    .await?;

    // --- Enum: media_visibility ---
    sqlx::raw_sql(&format!(
        "DO $$ BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'media_visibility' AND n.nspname = '{schema}'
           ) THEN
             CREATE TYPE \"{schema}\".media_visibility AS ENUM ('private','public','group','child');
           END IF;
         END $$"
    ))
    .execute(pool)
    .await?;

    // --- Enum: doc_category ---
    sqlx::raw_sql(&format!(
        "DO $$ BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'doc_category' AND n.nspname = '{schema}'
           ) THEN
             CREATE TYPE \"{schema}\".doc_category AS ENUM
               ('formulaire','menu','politique','bulletin','autre');
           END IF;
         END $$"
    ))
    .execute(pool)
    .await?;

    // --- Enum: doc_visibility ---
    sqlx::raw_sql(&format!(
        "DO $$ BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'doc_visibility' AND n.nspname = '{schema}'
           ) THEN
             CREATE TYPE \"{schema}\".doc_visibility AS ENUM
               ('private','public','group','child');
           END IF;
         END $$"
    ))
    .execute(pool)
    .await?;

    // --- Media ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".media (
            id                       UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
            uploader_id              UUID NOT NULL REFERENCES "{schema}".users(id),
            media_type               "{schema}".media_type NOT NULL,
            original_filename        TEXT NOT NULL,
            storage_path             TEXT NOT NULL,
            thumbnail_path           TEXT,
            content_type             VARCHAR(128) NOT NULL,
            size_bytes               BIGINT NOT NULL,
            width                    INT,
            height                   INT,
            duration_secs            DOUBLE PRECISION,
            group_id                 UUID REFERENCES "{schema}".groups(id),
            child_id                 UUID REFERENCES "{schema}".children(id) ON DELETE SET NULL,
            caption                  TEXT,
            visibility               "{schema}".media_visibility NOT NULL DEFAULT 'private',
            is_encrypted             BOOLEAN NOT NULL DEFAULT false,
            encryption_iv            BYTEA,
            encryption_tag           BYTEA,
            thumbnail_encryption_iv  BYTEA,
            thumbnail_encryption_tag BYTEA,
            created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#
    ))
    .execute(pool)
    .await?;

    // Idempotent: add columns for existing schemas
    sqlx::raw_sql(&format!(
        r#"ALTER TABLE "{schema}".media
           ADD COLUMN IF NOT EXISTS visibility "{schema}".media_visibility NOT NULL DEFAULT 'private',
           ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN NOT NULL DEFAULT false,
           ADD COLUMN IF NOT EXISTS encryption_iv BYTEA,
           ADD COLUMN IF NOT EXISTS encryption_tag BYTEA,
           ADD COLUMN IF NOT EXISTS thumbnail_encryption_iv BYTEA,
           ADD COLUMN IF NOT EXISTS thumbnail_encryption_tag BYTEA"#
    ))
    .execute(pool)
    .await?;

    sqlx::raw_sql(&format!(
        r#"CREATE INDEX IF NOT EXISTS media_group_idx      ON "{schema}".media(group_id);
           CREATE INDEX IF NOT EXISTS media_created_idx    ON "{schema}".media(created_at DESC);
           CREATE INDEX IF NOT EXISTS media_visibility_idx ON "{schema}".media(visibility)"#
    ))
    .execute(pool)
    .await?;

    // --- Media–children junction ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".media_children (
            media_id  UUID NOT NULL REFERENCES "{schema}".media(id) ON DELETE CASCADE,
            child_id  UUID NOT NULL REFERENCES "{schema}".children(id) ON DELETE CASCADE,
            PRIMARY KEY (media_id, child_id)
        )"#
    ))
    .execute(pool)
    .await?;

    sqlx::raw_sql(&format!(
        r#"CREATE INDEX IF NOT EXISTS media_children_child_idx ON "{schema}".media_children(child_id)"#
    ))
    .execute(pool)
    .await?;

    // --- Documents ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".documents (
            id                UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
            uploader_id       UUID NOT NULL REFERENCES "{schema}".users(id),
            title             VARCHAR(255) NOT NULL,
            category          "{schema}".doc_category NOT NULL DEFAULT 'autre',
            original_filename TEXT NOT NULL,
            storage_path      TEXT NOT NULL,
            content_type      VARCHAR(128) NOT NULL,
            size_bytes        BIGINT NOT NULL,
            group_id          UUID REFERENCES "{schema}".groups(id),
            child_id          UUID REFERENCES "{schema}".children(id) ON DELETE SET NULL,
            visibility        "{schema}".doc_visibility NOT NULL DEFAULT 'private',
            is_encrypted      BOOLEAN NOT NULL DEFAULT false,
            encryption_iv     BYTEA,
            encryption_tag    BYTEA,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#
    ))
    .execute(pool)
    .await?;

    // Idempotent: add columns for existing schemas
    sqlx::raw_sql(&format!(
        r#"ALTER TABLE "{schema}".documents
           ADD COLUMN IF NOT EXISTS visibility "{schema}".doc_visibility NOT NULL DEFAULT 'public',
           ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN NOT NULL DEFAULT false,
           ADD COLUMN IF NOT EXISTS encryption_iv BYTEA,
           ADD COLUMN IF NOT EXISTS encryption_tag BYTEA"#
    ))
    .execute(pool)
    .await?;

    // Idempotent: fix visibility for existing rows based on group_id/child_id
    sqlx::raw_sql(&format!(
        r#"UPDATE "{schema}".documents
           SET visibility = CASE
             WHEN child_id IS NOT NULL THEN 'child'::"{schema}".doc_visibility
             WHEN group_id IS NOT NULL THEN 'group'::"{schema}".doc_visibility
             ELSE 'public'::"{schema}".doc_visibility
           END
           WHERE visibility = 'public'
             AND (child_id IS NOT NULL OR group_id IS NOT NULL)"#
    ))
    .execute(pool)
    .await?;

    // --- Password reset tokens ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".password_reset_tokens (
            id         UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
            user_id    UUID NOT NULL REFERENCES "{schema}".users(id) ON DELETE CASCADE,
            token      TEXT UNIQUE NOT NULL,
            used       BOOLEAN NOT NULL DEFAULT FALSE,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#
    ))
    .execute(pool)
    .await?;

    // --- Two-factor auth codes ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".two_factor_codes (
            id         UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
            user_id    UUID NOT NULL REFERENCES "{schema}".users(id) ON DELETE CASCADE,
            code       VARCHAR(6) NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            used       BOOLEAN NOT NULL DEFAULT FALSE,
            attempts   SMALLINT NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#
    ))
    .execute(pool)
    .await?;

    // --- Trusted devices (2FA remember for 30 days) ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".trusted_devices (
            id         UUID PRIMARY KEY,
            user_id    UUID NOT NULL REFERENCES "{schema}".users(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#
    ))
    .execute(pool)
    .await?;

    // --- Push tokens ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".push_tokens (
            id         UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
            user_id    UUID NOT NULL REFERENCES "{schema}".users(id) ON DELETE CASCADE,
            platform   VARCHAR(16) NOT NULL,
            token      TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (user_id, token)
        )"#
    ))
    .execute(pool)
    .await?;

    // --- Enum: weather_condition ---
    sqlx::raw_sql(&format!(
        "DO $$ BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'weather_condition' AND n.nspname = '{schema}'
           ) THEN
             CREATE TYPE \"{schema}\".weather_condition AS ENUM
               ('ensoleille','nuageux','pluie','neige','orageux');
           END IF;
         END $$"
    ))
    .execute(pool)
    .await?;

    // --- Enum: appetit_level ---
    sqlx::raw_sql(&format!(
        "DO $$ BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'appetit_level' AND n.nspname = '{schema}'
           ) THEN
             CREATE TYPE \"{schema}\".appetit_level AS ENUM
               ('comme_habitude','peu','beaucoup','refuse');
           END IF;
         END $$"
    ))
    .execute(pool)
    .await?;

    // --- Enum: humeur_level ---
    sqlx::raw_sql(&format!(
        "DO $$ BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'humeur_level' AND n.nspname = '{schema}'
           ) THEN
             CREATE TYPE \"{schema}\".humeur_level AS ENUM
               ('tres_bien','bien','difficile','pleurs');
           END IF;
         END $$"
    ))
    .execute(pool)
    .await?;

    // --- Daily journals ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".daily_journals (
            id                 UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
            child_id           UUID NOT NULL REFERENCES "{schema}".children(id) ON DELETE CASCADE,
            date               DATE NOT NULL,
            temperature        "{schema}".weather_condition,
            menu               TEXT,
            appetit            "{schema}".appetit_level,
            humeur             "{schema}".humeur_level,
            sommeil_minutes    SMALLINT CHECK (sommeil_minutes >= 0 AND sommeil_minutes <= 180),
            absent             BOOLEAN NOT NULL DEFAULT FALSE,
            sante              TEXT,
            medicaments        TEXT,
            message_educatrice TEXT,
            observations       TEXT,
            sent_at            TIMESTAMPTZ,
            created_by         UUID NOT NULL REFERENCES "{schema}".users(id),
            created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (child_id, date)
        )"#
    ))
    .execute(pool)
    .await?;

    // --- Daily menus (garderie-level, one entry per date) ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".daily_menus (
            id         UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
            date       DATE NOT NULL UNIQUE,
            menu       TEXT NOT NULL,
            created_by UUID NOT NULL REFERENCES "{schema}".users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#
    ))
    .execute(pool)
    .await?;

    // --- Consent records (Loi 25) ---
    sqlx::raw_sql(&format!(
        r#"CREATE TABLE IF NOT EXISTS "{schema}".consent_records (
            id               UUID        PRIMARY KEY DEFAULT public.uuid_generate_v4(),
            user_id          UUID        NOT NULL REFERENCES "{schema}".users(id) ON DELETE CASCADE,
            privacy_accepted BOOLEAN     NOT NULL DEFAULT TRUE,
            photos_accepted  BOOLEAN     NOT NULL DEFAULT FALSE,
            accepted_at      TIMESTAMPTZ NOT NULL,
            policy_version   VARCHAR(32) NOT NULL,
            language         VARCHAR(8)  NOT NULL DEFAULT 'fr',
            ip_address       VARCHAR(64),
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#
    ))
    .execute(pool)
    .await?;

    // --- updated_at trigger function ---
    sqlx::raw_sql(&format!(
        r#"CREATE OR REPLACE FUNCTION "{schema}".update_updated_at()
           RETURNS TRIGGER AS $fn$
           BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
           $fn$ LANGUAGE plpgsql"#
    ))
    .execute(pool)
    .await?;

    // --- Triggers (one per table, idempotent via DROP IF EXISTS + CREATE) ---
    for table in &["users", "children", "groups", "messages", "documents", "daily_journals", "daily_menus"] {
        let trigger = format!("{table}_updated_at");
        sqlx::raw_sql(&format!(
            r#"DROP TRIGGER IF EXISTS "{trigger}" ON "{schema}"."{table}";
               CREATE TRIGGER "{trigger}"
               BEFORE UPDATE ON "{schema}"."{table}"
               FOR EACH ROW EXECUTE FUNCTION "{schema}".update_updated_at()"#
        ))
        .execute(pool)
        .await?;
    }

    tracing::info!("Provisioned tenant schema: {schema}");
    Ok(())
}

/// Returns the PostgreSQL schema name for a given garderie slug.
pub fn schema_name(slug: &str) -> String {
    format!("garderie_{}", slug.to_lowercase().replace('-', "_"))
}
