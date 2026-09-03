export const config = { runtime: 'edge' }

const SB_URL     = (process.env.SUPABASE_URL     || '').trim()
const SB_ANON    = (process.env.SUPABASE_ANON_KEY || '').trim()
const SB_SERVICE = (process.env.SUPABASE_SERVICE_KEY || '').trim()

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...CORS }
  })
}

function svcHeaders() {
  return { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Unauthorized' }, 401)

  // Valida o JWT do usuário logado
  const authRes = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` }
  })
  if (!authRes.ok) return json({ error: 'Unauthorized' }, 401)
  const me = await authRes.json()

  const company_id = me.user_metadata?.company_id
  if (!company_id) return json({ error: 'No company' }, 400)

  // ── GET: lista usuários ───────────────────────────────────────────
  if (req.method === 'GET') {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users?per_page=200`, { headers: svcHeaders() })
    if (!r.ok) {
      const txt = await r.text()
      return json({ error: `admin/users ${r.status}: ${txt}` }, 500)
    }
    const data = await r.json()
    const users = (data.users || [])
      .filter(u => u.user_metadata?.company_id === company_id)
      .map(u => ({
        id:         u.id,
        name:       u.user_metadata?.name     || '',
        username:   u.user_metadata?.username || '',
        role:       u.user_metadata?.role     || 'operator',
        created_at: u.created_at,
        last_sign:  u.last_sign_in_at,
      }))
    return json({ users })
  }

  // ── DELETE ────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { user_id } = await req.json()
    if (user_id === me.id) return json({ error: 'Não pode deletar a si mesmo' }, 400)

    const tRes = await fetch(`${SB_URL}/auth/v1/admin/users/${user_id}`, { headers: svcHeaders() })
    if (!tRes.ok) return json({ error: 'Usuário não encontrado' }, 404)
    const target = await tRes.json()
    if (target.user_metadata?.company_id !== company_id) return json({ error: 'Forbidden' }, 403)

    const dRes = await fetch(`${SB_URL}/auth/v1/admin/users/${user_id}`, { method: 'DELETE', headers: svcHeaders() })
    if (!dRes.ok) return json({ error: `Delete ${dRes.status}` }, 500)
    return json({ ok: true })
  }

  // ── PATCH: reset senha ────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { user_id, password } = await req.json()
    if (!user_id || !password) return json({ error: 'user_id e password obrigatórios' }, 400)
    if (password.length < 6) return json({ error: 'Senha mínimo 6 caracteres' }, 400)

    const tRes = await fetch(`${SB_URL}/auth/v1/admin/users/${user_id}`, { headers: svcHeaders() })
    if (!tRes.ok) return json({ error: 'Usuário não encontrado' }, 404)
    const target = await tRes.json()
    if (target.user_metadata?.company_id !== company_id) return json({ error: 'Forbidden' }, 403)

    const uRes = await fetch(`${SB_URL}/auth/v1/admin/users/${user_id}`, {
      method: 'PUT',
      headers: svcHeaders(),
      body: JSON.stringify({ password, user_metadata: { ...target.user_metadata, must_change_password: true } })
    })
    if (!uRes.ok) return json({ error: `Update ${uRes.status}` }, 500)
    return json({ ok: true })
  }

  return json({ error: 'Method not allowed' }, 405)
}
