-- ─────────────────────────────────────────────────────────────────
-- Controle de pagamento de colaboradores terceirizados
-- ─────────────────────────────────────────────────────────────────

-- Coluna de pagamento nas OSs
ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS collaborator_paid       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS collaborator_paid_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS collaborator_paid_value DECIMAL(12,2);

-- Coluna de pagamento nas tarefas (para tarefas sem OS)
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS collaborator_paid       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS collaborator_paid_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS collaborator_paid_value DECIMAL(12,2);

-- Índices para consultas rápidas de pendências
CREATE INDEX IF NOT EXISTS idx_so_collab_unpaid
  ON service_orders(collaborator_id, collaborator_paid)
  WHERE collaborator_paid = FALSE;

CREATE INDEX IF NOT EXISTS idx_tasks_collab_unpaid
  ON tasks(provider_id, collaborator_paid)
  WHERE collaborator_paid = FALSE;
