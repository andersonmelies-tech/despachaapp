export const config = { runtime: 'edge' }

const SB_URL     = (process.env.SUPABASE_URL          || '').trim()
const SB_ANON    = (process.env.SUPABASE_ANON_KEY     || '').trim()
const SB_SERVICE = (process.env.SUPABASE_SERVICE_KEY  || '').trim()

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

function svcHeaders() {
  return { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')   return json({ error: 'Method not allowed' }, 405)

  const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const authRes = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` }
  })
  if (!authRes.ok) return json({ error: 'Unauthorized' }, 401)
  const user = await authRes.json()
  if (!user?.id) return json({ error: 'Unauthorized' }, 401)

  let company_id = user.user_metadata?.company_id
  if (!company_id) {
    const r = await fetch(`${SB_URL}/rest/v1/companies?select=id&limit=1`, { headers: svcHeaders() })
    const rows = r.ok ? await r.json() : []
    company_id = rows?.[0]?.id
  }
  if (!company_id) return json({ error: 'company_id not found' }, 400)

  let body
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }

  const updates = Array.isArray(body.updates) ? body.updates : []
  const rows = updates
    .filter(u => u && typeof u.key === 'string' && u.key.trim())
    .map(u => ({ key: u.key, value: u.value ?? '' }))

  if (!rows.length) return json({ error: 'Nenhuma configuração válida informada' }, 400)

  for (const row of rows) {
    const patchRes = await fetch(
      `${SB_URL}/rest/v1/config?key=eq.${encodeURIComponent(row.key)}`,
      { method: 'PATCH', headers: svcHeaders(), body: JSON.stringify({ value: row.value, company_id }) }
    )
    const patchData = patchRes.ok ? await patchRes.json() : []

    if (!Array.isArray(patchData) || patchData.length === 0) {
      const insRes = await fetch(`${SB_URL}/rest/v1/config`, {
        method: 'POST', headers: svcHeaders(),
        body: JSON.stringify({ key: row.key, value: row.value, company_id })
      })
      if (!insRes.ok) {
        const e = await insRes.json().catch(() => ({}))
        return json({ error: e?.message || 'Insert failed' }, 500)
      }
    }
  }

  return json({ ok: true })
}
