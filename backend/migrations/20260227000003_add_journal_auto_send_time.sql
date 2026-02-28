-- Add per-tenant journal auto-send time setting
ALTER TABLE public.garderies
  ADD COLUMN IF NOT EXISTS journal_auto_send_time VARCHAR(5) NOT NULL DEFAULT '16:30';
