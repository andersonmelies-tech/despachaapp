import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const SB_URL     = process.env.SUPABASE_URL
const SB_ANON    = process.env.SUPABASE_ANON_KEY
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...CORS }
  })
}

// Regenera a api_key da empresa do usuário autenticado.
// Usa service role para o UPDATE — evita que uma política de RLS bloqueie
// silenciosamente a escrita (o cliente anônimo não detectaria isso).
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const sbAnon = createClient(SB_URL, SB_ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
  const { data: { user } } = await sbAnon.auth.getUser()
  if (!user) return json({ error: 'Unauthorized' }, 401)

  const company_id = user.user_metadata?.company_id
  if (!company_id) return json({ error: 'Usuário sem empresa associada' }, 400)

  const newKey = crypto.randomUUID().replace(/-/g, '')
  const sbService = createClient(SB_URL, SB_SERVICE)
  const { data, error } = await sbService
    .from('companies')
    .update({ api_key: newKey })
    .eq('id', company_id)
    .select('id, api_key')
    .single()

  if (error) return json({ error: error.message }, 500)
  if (!data) return json({ error: 'Empresa não encontrada' }, 404)

  return json({ api_key: data.api_key })
}
