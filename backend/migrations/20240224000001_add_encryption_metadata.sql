-- Add encryption metadata columns to media and documents tables
-- This migration supports gradual encryption of existing files

-- Add encryption fields to media table
ALTER TABLE IF EXISTS public.media 
ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN DEFAULT false NOT NULL,
ADD COLUMN IF NOT EXISTS encryption_iv BYTEA,
ADD COLUMN IF NOT EXISTS encryption_tag BYTEA,
ADD COLUMN IF NOT EXISTS thumbnail_encryption_iv BYTEA,
ADD COLUMN IF NOT EXISTS thumbnail_encryption_tag BYTEA;

-- Add encryption fields to documents table
ALTER TABLE IF EXISTS public.documents 
ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN DEFAULT false NOT NULL,
ADD COLUMN IF NOT EXISTS encryption_iv BYTEA,
ADD COLUMN IF NOT EXISTS encryption_tag BYTEA;

-- Add indexes for encrypted file queries
CREATE INDEX IF NOT EXISTS idx_media_is_encrypted ON public.media(is_encrypted);
CREATE INDEX IF NOT EXISTS idx_documents_is_encrypted ON public.documents(is_encrypted);

-- Add check constraints to ensure IV and tag are present when encrypted
ALTER TABLE public.media 
ADD CONSTRAINT chk_media_encryption_metadata 
CHECK (
    (is_encrypted = false) OR 
    (is_encrypted = true AND encryption_iv IS NOT NULL AND encryption_tag IS NOT NULL)
);

ALTER TABLE public.documents 
ADD CONSTRAINT chk_documents_encryption_metadata 
CHECK (
    (is_encrypted = false) OR 
    (is_encrypted = true AND encryption_iv IS NOT NULL AND encryption_tag IS NOT NULL)
);

COMMENT ON COLUMN public.media.is_encrypted IS 'Indicates if the file is encrypted at rest';
COMMENT ON COLUMN public.media.encryption_iv IS 'Initialization vector (12 bytes) for AES-256-GCM encryption of main file';
COMMENT ON COLUMN public.media.encryption_tag IS 'Authentication tag (16 bytes) for AES-256-GCM encryption of main file';
COMMENT ON COLUMN public.media.thumbnail_encryption_iv IS 'Initialization vector (12 bytes) for AES-256-GCM encryption of thumbnail';
COMMENT ON COLUMN public.media.thumbnail_encryption_tag IS 'Authentication tag (16 bytes) for AES-256-GCM encryption of thumbnail';

COMMENT ON COLUMN public.documents.is_encrypted IS 'Indicates if the file is encrypted at rest';
COMMENT ON COLUMN public.documents.encryption_iv IS 'Initialization vector (12 bytes) for AES-256-GCM encryption';
COMMENT ON COLUMN public.documents.encryption_tag IS 'Authentication tag (16 bytes) for AES-256-GCM encryption';
