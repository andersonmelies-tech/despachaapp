import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const SB_URL     = process.env.SUPABASE_URL
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'andersonmelies@gmail.com'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...CORS }
  })
}

async function getUser(token) {
  const sb = createClient(SB_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
  const { data: { user } } = await sb.auth.getUser()
  return user
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const user = await getUser(token)
  if (!user) return json({ error: 'Unauthorized' }, 401)

  // Verifica acesso admin
  const isAdmin = user.email === ADMIN_EMAIL || user.user_metadata?.is_superadmin === true
  if (!isAdmin) return json({ error: 'Forbidden' }, 403)

  const sb = createClient(SB_URL, SB_SERVICE)

  if (req.method === 'GET') {
    // Lista todas as empresas com stats
    const { data: companies, error } = await sb
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) return json({ error: error.message }, 500)

    // Conta usuários e tarefas por empresa
    const enriched = await Promise.all((companies || []).map(async (c) => {
      const [usersRes, tasksRes] = await Promise.all([
        sb.from('users').select('id', { count: 'exact', head: true }).eq('company_id', c.id),
        sb.from('tasks').select('id', { count: 'exact', head: true }).eq('company_id', c.id),
      ])
      return {
        ...c,
        users_count: usersRes.count || 0,
        tasks_count: tasksRes.count || 0,
      }
    }))

    // MRR
    const PLAN_PRICES = { starter: 97, pro: 197, enterprise: 497 }
    const mrr = enriched
      .filter(c => c.subscription_status === 'active')
      .reduce((sum, c) => sum + (PLAN_PRICES[c.plan] || 0), 0)

    return json({ companies: enriched, mrr })
  }

  if (req.method === 'POST') {
    const body = await req.json()
    const { action, company_id, days } = body

    if (action === 'extend_trial') {
      const newDate = new Date()
      newDate.setDate(newDate.getDate() + (days || 7))
      await sb.from('companies').update({
        trial_ends_at: newDate.toISOString(),
        subscription_status: 'trialing',
        plan: 'trial',
      }).eq('id', company_id)
      return json({ ok: true })
    }

    if (action === 'cancel') {
      await sb.from('companies').update({
        subscription_status: 'cancelled',
        plan: 'trial',
        stripe_subscription_id: null,
      }).eq('id', company_id)
      return json({ ok: true })
    }

    if (action === 'activate') {
      await sb.from('companies').update({
        subscription_status: 'active',
        plan: body.plan || 'pro',
      }).eq('id', company_id)
      return json({ ok: true })
    }

    return json({ error: 'Unknown action' }, 400)
  }

  return json({ error: 'Method not allowed' }, 405)
}
