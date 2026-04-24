-- Adicionar campos de cliente nas tarefas
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS client_name TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS client_address TEXT;

-- Tabela de clientes
CREATE TABLE IF NOT EXISTS clients (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id   UUID REFERENCES companies(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  address      TEXT,
  phone        TEXT,
  email        TEXT,
  notes        TEXT,
  active       BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company access clients" ON clients FOR ALL TO authenticated
  USING (company_id = (SELECT id FROM companies WHERE id = (auth.jwt()->>'company_id')::uuid LIMIT 1));

-- Tabela de orçamentos
-- NOTA: tasks.id é INTEGER, providers.id é INTEGER
CREATE TABLE IF NOT EXISTS budgets (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id   UUID REFERENCES companies(id) ON DELETE CASCADE,
  client_id    UUID REFERENCES clients(id),
  title        TEXT NOT NULL,
  description  TEXT,
  amount       DECIMAL(12,2) DEFAULT 0,
  status       TEXT DEFAULT 'pendente', -- pendente, aprovado, recusado, convertido
  task_id      INTEGER REFERENCES tasks(id),
  due_date     DATE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company access budgets" ON budgets FOR ALL TO authenticated
  USING (company_id = (SELECT id FROM companies WHERE id = (auth.jwt()->>'company_id')::uuid LIMIT 1));

-- Tabela de caixa (receitas e despesas)
CREATE TABLE IF NOT EXISTS cash_flow (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id       UUID REFERENCES companies(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN ('receita','despesa')),
  category         TEXT,
  description      TEXT NOT NULL,
  amount           DECIMAL(12,2) NOT NULL,
  date             DATE NOT NULL DEFAULT CURRENT_DATE,
  client_id        UUID REFERENCES clients(id),
  task_id          INTEGER REFERENCES tasks(id),
  budget_id        UUID REFERENCES budgets(id),
  collaborator_id  INTEGER REFERENCES providers(id),
  paid             BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE cash_flow ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company access cash_flow" ON cash_flow FOR ALL TO authenticated
  USING (company_id = (SELECT id FROM companies WHERE id = (auth.jwt()->>'company_id')::uuid LIMIT 1));

-- Adicionar campos nos colaboradores (providers)
ALTER TABLE providers ADD COLUMN IF NOT EXISTS is_third_party BOOLEAN DEFAULT FALSE;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS payment_rate   DECIMAL(12,2);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS payment_notes  TEXT;

-- Tipo de tarefa (interno/externo) — Pro e Enterprise
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type TEXT DEFAULT 'interno' CHECK (task_type IN ('interno','externo'));
