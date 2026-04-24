-- ─────────────────────────────────────────────────────────────────
-- Módulo: Ordens de Serviço + NFS-e
-- ─────────────────────────────────────────────────────────────────

-- Tabela principal de OS
CREATE TABLE IF NOT EXISTS service_orders (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id       UUID REFERENCES companies(id) ON DELETE CASCADE,
  os_number        TEXT NOT NULL DEFAULT '',
  client_id        UUID REFERENCES clients(id),
  budget_id        UUID REFERENCES budgets(id),
  task_id          INTEGER REFERENCES tasks(id),
  title            TEXT NOT NULL,
  description      TEXT,
  status           TEXT DEFAULT 'aberta'
                     CHECK (status IN ('aberta','andamento','concluida','faturada','cancelada')),
  collaborator_id  INTEGER REFERENCES providers(id),
  total_value      DECIMAL(12,2) DEFAULT 0,
  labor_value      DECIMAL(12,2) DEFAULT 0,
  materials_value  DECIMAL(12,2) DEFAULT 0,
  nfse_status      TEXT DEFAULT 'nao_emitida'
                     CHECK (nfse_status IN ('nao_emitida','emitindo','emitida','erro')),
  nfse_number      TEXT,
  nfse_url         TEXT,
  nfse_ref         TEXT,
  nfse_error       TEXT,
  due_date         DATE,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE service_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company access service_orders" ON service_orders FOR ALL TO authenticated
  USING (company_id = (
    SELECT id FROM companies
    WHERE id = (auth.jwt()->>'company_id')::uuid
    LIMIT 1
  ));

-- Índice para listagem rápida
CREATE INDEX IF NOT EXISTS idx_service_orders_company ON service_orders(company_id, created_at DESC);

-- Função que gera o número sequencial de OS por empresa
CREATE OR REPLACE FUNCTION generate_os_number()
RETURNS TRIGGER AS $$
DECLARE
  next_num INTEGER;
BEGIN
  -- Somente gera se não foi fornecido
  IF NEW.os_number IS NULL OR NEW.os_number = '' THEN
    SELECT COALESCE(
      MAX(
        CAST(
          REGEXP_REPLACE(os_number, '[^0-9]', '', 'g') AS INTEGER
        )
      ), 0
    ) + 1
    INTO next_num
    FROM service_orders
    WHERE company_id = NEW.company_id;

    NEW.os_number := 'OS-' || LPAD(next_num::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger que chama a função antes de inserir
DROP TRIGGER IF EXISTS trg_os_number ON service_orders;
CREATE TRIGGER trg_os_number
  BEFORE INSERT ON service_orders
  FOR EACH ROW
  EXECUTE FUNCTION generate_os_number();

-- Liga orçamento à OS (conversão orçamento → OS)
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS service_order_id UUID REFERENCES service_orders(id);

-- ─────────────────────────────────────────────────────────────────
-- Chaves de configuração NFS-e (armazenadas na tabela config)
-- Documenação das chaves utilizadas pela API Focus NFe:
--   nfse_token              — token da API Focus NFe
--   nfse_ambiente           — 'homologacao' ou 'producao'
--   nfse_cnpj               — CNPJ da empresa emitente (somente números)
--   nfse_razao_social       — Razão social da empresa
--   nfse_inscricao_municipal — Inscrição municipal
--   nfse_codigo_municipio   — Código IBGE do município
--   nfse_codigo_servico     — Código do serviço (lista de serviços)
--   nfse_aliquota           — Alíquota ISS (ex: '0.05' para 5%)
--   nfse_discriminacao      — Texto padrão de discriminação dos serviços
-- ─────────────────────────────────────────────────────────────────
