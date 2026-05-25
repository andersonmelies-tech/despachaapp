-- Solicitações públicas: campos extras na tabela tasks
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS source          TEXT    DEFAULT 'interno',  -- 'interno' | 'publico'
  ADD COLUMN IF NOT EXISTS needs_approval  BOOLEAN DEFAULT FALSE,      -- aguardando aprovação do ADM
  ADD COLUMN IF NOT EXISTS requester_phone TEXT;                       -- telefone do solicitante público

-- Índice para a fila de aprovação
CREATE INDEX IF NOT EXISTS idx_tasks_needs_approval ON tasks(needs_approval) WHERE needs_approval = TRUE;
