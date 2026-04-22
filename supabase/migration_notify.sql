-- Migration: coluna para controlar notificação de nova tarefa ao prestador
-- Execute no SQL Editor do Supabase

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS provider_notified BOOLEAN DEFAULT FALSE;

-- Marca tarefas existentes como já notificadas (evita spam retroativo)
UPDATE tasks SET provider_notified = TRUE WHERE provider_notified IS NULL OR provider_notified = FALSE;

-- Chave na tabela config para o chat_id do admin (Telegram)
-- Após rodar, insira o chat_id do administrador:
-- INSERT INTO config (key, value) VALUES ('admin_chat_id', 'SEU_CHAT_ID') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
