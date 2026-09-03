export const config = { runtime: 'edge' }

const SB_URL     = process.env.SUPABASE_URL
const SB_ANON   = process.env.SUPABASE_ANON_KEY
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@despachaapp.app'

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

function toEmail(username) {
  const clean = username.toLowerCase().replace(/[^a-z0-9._-]/g, '')
  return `${clean}@despachaapp.internal`
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Verifica JWT do admin que está criando
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const authRes = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` }
  })
  if (!authRes.ok) return json({ error: 'Unauthorized' }, 401)
  const adminUser = await authRes.json()

  // Só admin/manager podem criar usuários (ou o super admin pelo e-mail)
  const role = adminUser.user_metadata?.role
  const isSuperAdmin = adminUser.email === ADMIN_EMAIL
  if (!isSuperAdmin && !['admin', 'manager'].includes(role)) return json({ error: 'Forbidden' }, 403)

  // Super admin: busca company_id via REST (não tem company_id no metadata)
  let company_id = adminUser.user_metadata?.company_id
  if (!company_id && isSuperAdmin) {
    const cmpRes = await fetch(`${SB_URL}/rest/v1/companies?select=id&limit=1`, {
      headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` }
    })
    const cmpData = await cmpRes.json()
    company_id = cmpData[0]?.id
  }
  if (!company_id) return json({ error: 'Company not found' }, 400)

  const { name, username, password, role: newRole } = await req.json()

  if (!name || !username || !password) return json({ error: 'Campos obrigatórios: name, username, password' }, 400)
  if (password.length < 6) return json({ error: 'Senha mínimo 6 caracteres' }, 400)

  const email = toEmail(username)

  const cRes = await fetch(`${SB_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, username, role: newRole || 'operator', company_id, must_change_password: true }
    })
  })
  const cData = await cRes.json()
  if (!cRes.ok) return json({ error: cData.msg || cData.message || 'Erro ao criar usuário' }, 400)

  return json({ ok: true, user_id: cData.id })
}
