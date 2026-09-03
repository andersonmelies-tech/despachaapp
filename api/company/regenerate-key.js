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

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const authRes = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` }
  })
  if (!authRes.ok) return json({ error: 'Unauthorized' }, 401)
  const user = await authRes.json()

  const company_id = user.user_metadata?.company_id
  if (!company_id) return json({ error: 'Usuário sem empresa associada' }, 400)

  const newKey = crypto.randomUUID().replace(/-/g, '')

  const r = await fetch(
    `${SB_URL}/rest/v1/companies?id=eq.${encodeURIComponent(company_id)}`,
    {
      method: 'PATCH',
      headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ api_key: newKey }),
    }
  )
  const data = r.ok ? await r.json() : null
  if (!r.ok || !data?.length) return json({ error: 'Empresa não encontrada' }, 404)

  return json({ api_key: data[0].api_key })
}
