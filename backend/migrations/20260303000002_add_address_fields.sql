-- Split address into structured fields
ALTER TABLE public.garderies RENAME COLUMN address TO address_line1;
ALTER TABLE public.garderies ADD COLUMN IF NOT EXISTS city        VARCHAR(128);
ALTER TABLE public.garderies ADD COLUMN IF NOT EXISTS province    VARCHAR(64);
ALTER TABLE public.garderies ADD COLUMN IF NOT EXISTS postal_code VARCHAR(16);
