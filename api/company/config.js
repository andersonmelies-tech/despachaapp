import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

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

// Salva pares chave/valor na tabela config da empresa do usuário autenticado.
// Usa service role — a tabela config tem RLS que bloqueia escrita pelo cliente,
// por isso todas as gravações de config passam pelo servidor.
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')   return json({ error: 'Method not allowed' }, 405)

  const url     = process.env.SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_KEY
  const anon    = process.env.SUPABASE_ANON_KEY

  const token = (req.headers.get('authorization') || '').replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const sbAuth = createClient(url, anon)
  const { data: { user }, error: authErr } = await sbAuth.auth.getUser(token)
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  const sb = createClient(url, service)

  let company_id = user.user_metadata?.company_id
  if (!company_id) {
    const { data: co } = await sb.from('companies').select('id').limit(1).maybeSingle()
    company_id = co?.id
  }
  if (!company_id) return json({ error: 'company_id not found' }, 400)

  let body
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }

  const updates = Array.isArray(body.updates) ? body.updates : []
  const rows = updates
    .filter(u => u && typeof u.key === 'string' && u.key.trim())
    .map(u => ({ key: u.key, value: u.value ?? '' }))

  if (!rows.length) return json({ error: 'Nenhuma configuração válida informada' }, 400)

  // UPDATE por key e, se não existir, INSERT — mesmo padrão do branding.
  // (o banco não tem a constraint composta (key, company_id) para usar ON CONFLICT)
  for (const row of rows) {
    const { data, error: updErr } = await sb
      .from('config')
      .update({ value: row.value, company_id })
      .eq('key', row.key)
      .select('key')
    if (updErr) return json({ error: updErr.message }, 500)

    if (!data || data.length === 0) {
      const { error: insErr } = await sb.from('config').insert({ key: row.key, value: row.value, company_id })
      if (insErr) return json({ error: insErr.message }, 500)
    }
  }

  return json({ ok: true })
}
