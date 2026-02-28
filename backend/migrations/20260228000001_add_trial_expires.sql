ALTER TABLE public.garderies
    ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ;
