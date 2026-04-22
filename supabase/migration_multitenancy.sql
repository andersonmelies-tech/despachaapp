-- ============================================================
-- MULTI-TENANCY MIGRATION — DespachaApp
-- Execute no SQL Editor do Supabase
-- ============================================================

-- 1. Tabela de empresas
CREATE TABLE IF NOT EXISTS companies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE,
  plan       TEXT DEFAULT 'starter',  -- starter, pro, enterprise
  active     BOOLEAN DEFAULT TRUE,
  invite_code TEXT UNIQUE DEFAULT substring(md5(random()::text), 1, 8),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Inserir empresa padrão para dados existentes
INSERT INTO companies (id, name, slug, plan)
VALUES ('00000000-0000-0000-0000-000000000001', 'Empresa Padrão', 'default', 'pro')
ON CONFLICT DO NOTHING;

-- 3. Adicionar company_id em todas as tabelas
ALTER TABLE tasks        ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE providers    ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE sectors      ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE sla_config   ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE config       ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE task_history ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) DEFAULT '00000000-0000-0000-0000-000000000001';

-- 4. Preencher dados existentes com a empresa padrão
UPDATE tasks        SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE providers    SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE sectors      SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE sla_config   SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE config       SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE task_history SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;

-- 5. Tornar company_id NOT NULL após preencher
ALTER TABLE tasks        ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE providers    ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE sectors      ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE sla_config   ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE config       ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE task_history ALTER COLUMN company_id SET NOT NULL;

-- 6. Remover default (não queremos inserções sem company_id explícito)
ALTER TABLE tasks        ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE providers    ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE sectors      ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE sla_config   ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE config       ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE task_history ALTER COLUMN company_id DROP DEFAULT;

-- 7. Ativar RLS em todas as tabelas
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

-- 9. Políticas RLS — companies
CREATE POLICY "companies_select" ON companies FOR SELECT
  USING (id = current_company_id());

CREATE POLICY "companies_insert_anon" ON companies FOR INSERT
  WITH CHECK (true);  -- permite cadastro de nova empresa (fluxo de registro)

-- 10. Políticas RLS — tasks
CREATE POLICY "tasks_company" ON tasks FOR ALL
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

-- 11. Políticas RLS — providers
CREATE POLICY "providers_company" ON providers FOR ALL
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

-- 12. Políticas RLS — sectors
CREATE POLICY "sectors_company" ON sectors FOR ALL
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

-- 13. Políticas RLS — sla_config
CREATE POLICY "sla_company" ON sla_config FOR ALL
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

-- 14. Políticas RLS — config
CREATE POLICY "config_company" ON config FOR ALL
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

-- 15. Políticas RLS — task_history
CREATE POLICY "history_company" ON task_history FOR ALL
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

-- 16. Atualizar usuário existente com company_id padrão
-- Execute manualmente substituindo o email real do seu admin:
-- UPDATE auth.users
-- SET raw_user_meta_data = raw_user_meta_data || '{"company_id": "00000000-0000-0000-0000-000000000001"}'::jsonb
-- WHERE email LIKE '%@despachaapp.app';
