-- Bucket público para logos e branding das empresas
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branding',
  'branding',
  true,
  2097152,  -- 2 MB
  ARRAY['image/jpeg','image/png','image/webp','image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read branding"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'branding');

CREATE POLICY "Service role upload branding"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'branding');

CREATE POLICY "Service role update branding"
  ON storage.objects FOR UPDATE
  TO service_role
  USING (bucket_id = 'branding');
