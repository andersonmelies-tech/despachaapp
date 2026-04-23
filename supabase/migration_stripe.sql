-- ============================================================
-- STRIPE INTEGRATION — DespachaApp
-- Execute no SQL Editor do Supabase
-- ============================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_customer_id    TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS plan                   TEXT DEFAULT 'trial';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_status    TEXT DEFAULT 'trialing';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS trial_ends_at          TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days');
ALTER TABLE companies ADD COLUMN IF NOT EXISTS current_period_end     TIMESTAMPTZ;

-- Empresas existentes: dar 14 dias de trial a partir de hoje
UPDATE companies
SET trial_ends_at = NOW() + INTERVAL '14 days',
    subscription_status = 'trialing',
    plan = 'trial'
WHERE trial_ends_at IS NULL;
