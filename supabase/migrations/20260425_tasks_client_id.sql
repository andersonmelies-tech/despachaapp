-- Adiciona a FK client_id na tabela tasks
-- (client_name e client_address já foram adicionados em 20260424_enterprise_modules.sql)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);

-- Força o Supabase a revalidar o schema cache
-- (não é necessário SQL, mas o NOTIFY ajuda em alguns configs)
NOTIFY pgrst, 'reload schema';
