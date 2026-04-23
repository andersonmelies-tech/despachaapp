-- ============================================================
-- MULTI-TENANCY MIGRATION — DespachaApp
-- Execute no SQL Editor do Supabase (em ordem)
-- ============================================================

-- 1. Tabela de empresas
CREATE TABLE IF NOT EXISTS companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE,
  plan        TEXT DEFAULT 'starter',  -- starter, pro, enterprise
  active      BOOLEAN DEFAULT TRUE,
  invite_code TEXT UNIQUE DEFAULT substring(md5(random()::text), 1, 8),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Empresa padrão para dados existentes
INSERT INTO companies (id, name, slug, plan)
VALUES ('00000000-0000-0000-0000-000000000001', 'Minha Empresa', 'default', 'pro')
ON CONFLICT DO NOTHING;

-- 3. Adicionar company_id em todas as tabelas
ALTER TABLE tasks        ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE providers    ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE sectors      ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE sla_config   ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE config       ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE task_history ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) DEFAULT '00000000-0000-0000-0000-000000000001';

-- 4. Preencher dados existentes
UPDATE tasks        SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE providers    SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE sectors      SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE sla_config   SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE config       SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE task_history SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;

-- 5. Tornar NOT NULL após preencher
ALTER TABLE tasks        ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE providers    ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE sectors      ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE sla_config   ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE config       ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE task_history ALTER COLUMN company_id SET NOT NULL;

-- 6. Remover defaults (inserções futuras precisam de company_id explícito)
ALTER TABLE tasks        ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE providers    ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE sectors      ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE sla_config   ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE config       ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE task_history ALTER COLUMN company_id DROP DEFAULT;

-- 7. Ativar RLS
ALTER TABLE companies    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sectors      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE config       ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_history ENABLE ROW LEVEL SECURITY;

-- 8. Helper: extrai company_id do JWT
CREATE OR REPLACE FUNCTION current_company_id() RETURNS UUID AS $$
  SELECT ((auth.jwt() -> 'user_metadata') ->> 'company_id')::UUID;
$$ LANGUAGE SQL STABLE;

-- 9. Função segura para criar empresa no cadastro (SECURITY DEFINER bypassa RLS)
--    Usada pelo Register.jsx via supabase.rpc('create_company', {company_name: '...'})
CREATE OR REPLACE FUNCTION create_company(company_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id UUID;
BEGIN
  INSERT INTO companies (name)
  VALUES (company_name)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- 10. Políticas RLS — companies
DROP POLICY IF EXISTS "companies_select" ON companies;
DROP POLICY IF EXISTS "companies_insert_anon" ON companies;

CREATE POLICY "companies_select" ON companies FOR SELECT
  USING (id = current_company_id());

-- INSERT via função create_company (SECURITY DEFINER), anon não insere direto
-- mas precisamos permitir INSERT para usuários autenticados (admin convidando)
CREATE POLICY "companies_insert_auth" ON companies FOR INSERT
  WITH CHECK (true);

-- 11. Políticas RLS — tasks
DROP POLICY IF EXISTS "tasks_company" ON tasks;
CREATE POLICY "tasks_company" ON tasks FOR ALL
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

-- 12. Políticas RLS — providers
DROP POLICY IF EXISTS "providers_company" ON providers;
CREATE POLICY "providers_company" ON providers FOR ALL
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

-- 13. Políticas RLS — sectors
DROP POLICY IF EXISTS "sectors_company" ON sectors;
CREATE POLICY "sectors_company" ON sectors FOR ALL
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

-- 14. Políticas RLS — sla_config
DROP POLICY IF EXISTS "sla_company" ON sla_config;
CREATE POLICY "sla_company" ON sla_config FOR ALL
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

-- 15. Políticas RLS — config
DROP POLICY IF EXISTS "config_company" ON config;
CREATE POLICY "config_company" ON config FOR ALL
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

-- 16. Políticas RLS — task_history
DROP POLICY IF EXISTS "history_company" ON task_history;
CREATE POLICY "history_company" ON task_history FOR ALL
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

-- ============================================================
-- PASSO FINAL — vincular seu usuário admin existente
-- Substitua 'seu.usuario' pelo nome de usuário que você usa no login
-- ============================================================
-- UPDATE auth.users
-- SET raw_user_meta_data = raw_user_meta_data ||
--     '{"company_id": "00000000-0000-0000-0000-000000000001", "role": "admin"}'::jsonb
-- WHERE email = 'seu.usuario@despachaapp.app';
