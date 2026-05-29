-- Cria bucket público para fotos de tarefas
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-photos',
  'task-photos',
  true,
  5242880,  -- 5 MB por arquivo
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Permite leitura pública (sem autenticação)
CREATE POLICY "Public read task photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'task-photos');

-- Permite upload via service_role (sem restrição — a API usa service key)
CREATE POLICY "Service role upload task photos"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'task-photos');

CREATE POLICY "Service role delete task photos"
  ON storage.objects FOR DELETE
  TO service_role
  USING (bucket_id = 'task-photos');
