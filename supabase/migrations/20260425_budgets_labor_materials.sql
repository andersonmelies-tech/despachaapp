-- Separação de mão de obra e materiais no orçamento
ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS labor_value     DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS materials_value DECIMAL(12,2) DEFAULT 0;
