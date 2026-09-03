export const config = { runtime: 'edge' }

const SB_URL      = (process.env.SUPABASE_URL          || '').trim()
const SB_ANON     = (process.env.SUPABASE_ANON_KEY     || '').trim()
const SB_SERVICE  = (process.env.SUPABASE_SERVICE_KEY  || '').trim()
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@despachaapp.app').trim()

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

function svcHeaders() {
  return { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' }
}

async function restGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: svcHeaders() })
  return r.ok ? r.json() : null
}

async function restPatch(path, data) {
  await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: 'PATCH', headers: svcHeaders(), body: JSON.stringify(data)
  })
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const authRes = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` }
  })
  if (!authRes.ok) return json({ error: 'Unauthorized' }, 401)
  const user = await authRes.json()

  const isAdmin = user.email === ADMIN_EMAIL || user.user_metadata?.is_superadmin === true
  if (!isAdmin) return json({ error: 'Forbidden' }, 403)

  if (req.method === 'GET') {
    const companies = await restGet('companies?select=*&order=created_at.desc') || []

    const enriched = await Promise.all(companies.map(async (c) => {
      const [tasksData] = await Promise.all([
        restGet(`tasks?select=id&company_id=eq.${c.id}&limit=1&head=true`),
      ])
      // Conta usuários via auth admin API
      const uRes = await fetch(`${SB_URL}/auth/v1/admin/users?per_page=200`, { headers: svcHeaders() })
      const uData = uRes.ok ? await uRes.json() : { users: [] }
      const users_count = (uData.users || []).filter(u => u.user_metadata?.company_id === c.id).length

      return { ...c, users_count, tasks_count: 0 }
    }))

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
      await restPatch(`companies?id=eq.${company_id}`, {
        trial_ends_at: newDate.toISOString(),
        subscription_status: 'trialing',
        plan: 'trial',
      })
      return json({ ok: true })
    }

    if (action === 'cancel') {
      await restPatch(`companies?id=eq.${company_id}`, {
        subscription_status: 'cancelled',
        plan: 'trial',
        stripe_subscription_id: null,
      })
      return json({ ok: true })
    }

    if (action === 'activate') {
      await restPatch(`companies?id=eq.${company_id}`, {
        subscription_status: 'active',
        plan: body.plan || 'pro',
      })
      return json({ ok: true })
    }

    return json({ error: 'Unknown action' }, 400)
  }

  return json({ error: 'Method not allowed' }, 405)
}
