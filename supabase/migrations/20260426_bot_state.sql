-- Estado da sessão do bot Telegram (substitui dict em memória do polling)
-- Necessário para o modo webhook stateless no Vercel
CREATE TABLE IF NOT EXISTS bot_sessions (
  chat_id    TEXT PRIMARY KEY,
  mode       TEXT,               -- 'obs' | 'newdate' | 'search' | 'name' | null
  task_id    INTEGER,
  extra      JSONB DEFAULT '{}', -- invite_code etc
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sem RLS: o bot usa service_role key (sem restrições)
-- Limpa sessões antigas automaticamente
CREATE OR REPLACE FUNCTION cleanup_old_bot_sessions()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM bot_sessions WHERE updated_at < NOW() - INTERVAL '2 hours';
$$;
