-- ── API Key por empresa ──────────────────────────────────────────────────────
-- Adiciona coluna api_key única por empresa
ALTER TABLE companies ADD COLUMN IF NOT EXISTS api_key TEXT UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', '');

-- Garante que empresas existentes tenham api_key preenchida
UPDATE companies
SET api_key = replace(gen_random_uuid()::text, '-', '')
WHERE api_key IS NULL;

-- Índice para lookup rápido por api_key nos endpoints
CREATE UNIQUE INDEX IF NOT EXISTS companies_api_key_idx ON companies (api_key);
