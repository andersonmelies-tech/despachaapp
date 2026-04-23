import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const SB_URL     = process.env.SUPABASE_URL
const SB_ANON   = process.env.SUPABASE_ANON_KEY
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...CORS }
  })
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const sbAnon = createClient(SB_URL, SB_ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
  const { data: { user: adminUser } } = await sbAnon.auth.getUser()
  if (!adminUser) return json({ error: 'Unauthorized' }, 401)

  const company_id = adminUser.user_metadata?.company_id
  if (!company_id) return json({ error: 'No company' }, 400)

  const sbService = createClient(SB_URL, SB_SERVICE)

  if (req.method === 'GET') {
    // Lista todos os usuários do Supabase Auth e filtra pelo company_id
    const { data, error } = await sbService.auth.admin.listUsers({ perPage: 200 })
    if (error) return json({ error: error.message }, 500)

    const users = (data?.users || [])
      .filter(u => u.user_metadata?.company_id === company_id)
      .map(u => ({
        id:         u.id,
        name:       u.user_metadata?.name || '',
        username:   u.user_metadata?.username || '',
        role:       u.user_metadata?.role || 'operator',
        created_at: u.created_at,
        last_sign:  u.last_sign_in_at,
      }))

    return json({ users })
  }

  if (req.method === 'DELETE') {
    const { user_id } = await req.json()
    // Impede deletar a si mesmo
    if (user_id === adminUser.id) return json({ error: 'Não pode deletar a si mesmo' }, 400)

    // Verifica se o usuário pertence à mesma empresa
    const { data: target } = await sbService.auth.admin.getUserById(user_id)
    if (target?.user?.user_metadata?.company_id !== company_id) return json({ error: 'Forbidden' }, 403)

    const { error } = await sbService.auth.admin.deleteUser(user_id)
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  }

  return json({ error: 'Method not allowed' }, 405)
}
