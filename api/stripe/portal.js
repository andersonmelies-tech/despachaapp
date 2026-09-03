export const config = { runtime: 'edge' }

const SK      = (process.env.STRIPE_SECRET_KEY  || '').trim()
const SB_URL  = (process.env.SUPABASE_URL        || '').trim()
const SB_ANON = (process.env.SUPABASE_ANON_KEY   || '').trim()
const SB_SVC  = (process.env.SUPABASE_SERVICE_KEY || '').trim()
const APP_URL = process.env.APP_URL || 'https://www.despachaapp.com.br'

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

  const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` }
  })
  if (!userRes.ok) return json({ error: 'Unauthorized' }, 401)
  const user = await userRes.json()
  const company_id = user.user_metadata?.company_id
  if (!company_id) return json({ error: 'Company not found' }, 404)

  const coRes = await fetch(
    `${SB_URL}/rest/v1/companies?select=stripe_customer_id&id=eq.${encodeURIComponent(company_id)}&limit=1`,
    { headers: { apikey: SB_SVC, Authorization: `Bearer ${SB_SVC}` } }
  )
  const rows    = coRes.ok ? await coRes.json() : []
  const company = rows?.[0]

  if (!company?.stripe_customer_id) return json({ error: 'No subscription found' }, 404)

  const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SK}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ customer: company.stripe_customer_id, return_url: APP_URL }),
  })
  const session = await res.json()
  if (!session.url) return json({ error: 'Failed to create portal session' }, 500)

  return json({ url: session.url })
}
