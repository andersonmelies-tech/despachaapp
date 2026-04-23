import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const SB_URL     = process.env.SUPABASE_URL
const SB_ANON   = process.env.SUPABASE_ANON_KEY
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

  const sbAnon = createClient(SB_URL, SB_ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
  const { data: { user: adminUser } } = await sbAnon.auth.getUser()
  if (!adminUser) return json({ error: 'Unauthorized' }, 401)

  // Só admin e manager podem criar usuários
  const role = adminUser.user_metadata?.role
  if (!['admin', 'manager'].includes(role)) return json({ error: 'Forbidden' }, 403)

  const company_id = adminUser.user_metadata?.company_id
  if (!company_id) return json({ error: 'Company not found' }, 400)

  const { name, username, password, role: newRole } = await req.json()

  if (!name || !username || !password) return json({ error: 'Campos obrigatórios: name, username, password' }, 400)
  if (password.length < 6) return json({ error: 'Senha mínimo 6 caracteres' }, 400)

  const email = toEmail(username)

  // Cria usuário com service key (sem confirmação de e-mail)
  const sbService = createClient(SB_URL, SB_SERVICE)
  const { data, error } = await sbService.auth.admin.createUser({
    email,
    password,
    email_confirm: true,   // confirma automaticamente, sem e-mail
    user_metadata: {
      name,
      username,
      role: newRole || 'operator',
      company_id,
    }
  })

  if (error) return json({ error: error.message }, 400)

  return json({ ok: true, user_id: data.user?.id })
}
