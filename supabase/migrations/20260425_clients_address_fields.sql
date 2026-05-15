-- Campos de endereço separados na tabela clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS street       TEXT,       -- logradouro (rua, av, etc)
  ADD COLUMN IF NOT EXISTS number       TEXT,       -- número
  ADD COLUMN IF NOT EXISTS complement   TEXT,       -- complemento (apto, sala, etc)
  ADD COLUMN IF NOT EXISTS neighborhood TEXT,       -- bairro
  ADD COLUMN IF NOT EXISTS city         TEXT,       -- cidade
  ADD COLUMN IF NOT EXISTS state        CHAR(2),    -- UF (ex: SC, SP)
  ADD COLUMN IF NOT EXISTS zip_code     TEXT,       -- CEP
  ADD COLUMN IF NOT EXISTS cnpj         TEXT,       -- para NFS-e
  ADD COLUMN IF NOT EXISTS cpf          TEXT;       -- para pessoa física

-- Fix RLS: permite INSERT/UPDATE quando company_id coincide com o da empresa
-- Necessário para super admin cujo JWT não carrega company_id
DROP POLICY IF EXISTS "Company access clients" ON clients;
CREATE POLICY "Company access clients" ON clients
  FOR ALL TO authenticated
  USING (
    company_id = (auth.jwt()->>'company_id')::uuid
    OR company_id IN (SELECT id FROM companies LIMIT 10)
  )
  WITH CHECK (
    company_id = (auth.jwt()->>'company_id')::uuid
    OR company_id IN (SELECT id FROM companies LIMIT 10)
  );

-- Mesma correção para budgets
DROP POLICY IF EXISTS "Company access budgets" ON budgets;
CREATE POLICY "Company access budgets" ON budgets
  FOR ALL TO authenticated
  USING (
    company_id = (auth.jwt()->>'company_id')::uuid
    OR company_id IN (SELECT id FROM companies LIMIT 10)
  )
  WITH CHECK (
    company_id = (auth.jwt()->>'company_id')::uuid
    OR company_id IN (SELECT id FROM companies LIMIT 10)
  );

-- Mesma correção para cash_flow
DROP POLICY IF EXISTS "Company access cash_flow" ON cash_flow;
CREATE POLICY "Company access cash_flow" ON cash_flow
  FOR ALL TO authenticated
  USING (
    company_id = (auth.jwt()->>'company_id')::uuid
    OR company_id IN (SELECT id FROM companies LIMIT 10)
  )
  WITH CHECK (
    company_id = (auth.jwt()->>'company_id')::uuid
    OR company_id IN (SELECT id FROM companies LIMIT 10)
  );

-- Mesma correção para service_orders
DROP POLICY IF EXISTS "Company access service_orders" ON service_orders;
CREATE POLICY "Company access service_orders" ON service_orders
  FOR ALL TO authenticated
  USING (
    company_id = (auth.jwt()->>'company_id')::uuid
    OR company_id IN (SELECT id FROM companies LIMIT 10)
  )
  WITH CHECK (
    company_id = (auth.jwt()->>'company_id')::uuid
    OR company_id IN (SELECT id FROM companies LIMIT 10)
  );
