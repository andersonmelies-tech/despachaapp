-- ── Tabela de regras de recorrência ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_recurrences (
  id               SERIAL PRIMARY KEY,
  title            TEXT NOT NULL,
  description      TEXT,
  requester        TEXT,
  requester_sector TEXT,
  assignee_id      INTEGER,
  assignee         TEXT,
  urgency          TEXT DEFAULT 'media',
  category         TEXT,
  sector           TEXT,
  -- Frequência: daily | weekly | monthly
  frequency        TEXT NOT NULL DEFAULT 'weekly',
  day_of_week      INTEGER,   -- 0=Dom 1=Seg 2=Ter 3=Qua 4=Qui 5=Sex 6=Sab (weekly)
  day_of_month     INTEGER,   -- 1-28 (monthly)
  start_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date         DATE,      -- NULL = sem prazo / para sempre
  active           BOOLEAN DEFAULT TRUE,
  company_id       UUID REFERENCES companies(id),
  last_generated   DATE,      -- última data para a qual tarefas foram geradas
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Colunas adicionais na tabela tasks ───────────────────────────────────────
-- (source já existe se rodou 20260426_public_requests.sql)
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS recurrence_id   INTEGER REFERENCES task_recurrences(id),
  ADD COLUMN IF NOT EXISTS recurrence_date DATE;

-- ── Índices ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_id ON tasks(recurrence_id) WHERE recurrence_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rec_active           ON task_recurrences(active);
CREATE INDEX IF NOT EXISTS idx_rec_company          ON task_recurrences(company_id);
