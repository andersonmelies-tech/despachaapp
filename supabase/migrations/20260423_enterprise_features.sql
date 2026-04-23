-- ── Enterprise Features Migration ────────────────────────────────────────────
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- 1. Add sla_notified column to tasks table (for SLA alert cron)
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS sla_notified BOOLEAN DEFAULT FALSE;

-- Index for faster SLA cron queries
CREATE INDEX IF NOT EXISTS tasks_sla_check_idx
  ON tasks (company_id, status, sla_notified)
  WHERE status != 'concluida' AND sla_notified IS NOT TRUE;

-- 2. Add telegram_chat_id to companies (for company-level SLA alerts)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;

-- 3. Ensure config table has company_id column for branding upserts
-- (config table should already have this — this is a safety check)
ALTER TABLE config
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

-- 4. Unique constraint for config key per company (needed for upsert onConflict)
-- Drop first in case it exists with a different name
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'config_key_company_id_key'
  ) THEN
    ALTER TABLE config ADD CONSTRAINT config_key_company_id_key UNIQUE (key, company_id);
  END IF;
END $$;

-- 5. Create Supabase Storage bucket for branding logos
-- NOTE: Run this separately in Supabase Dashboard → Storage → New bucket
-- Bucket name: branding
-- Public: YES (so logo URLs work without auth)
-- Or run via SQL:
INSERT INTO storage.buckets (id, name, public)
VALUES ('branding', 'branding', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: allow authenticated users to upload to their company folder
CREATE POLICY "Company users can upload branding"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'branding');

CREATE POLICY "Branding logos are public"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'branding');

CREATE POLICY "Company users can update branding"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'branding');
