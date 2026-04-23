import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const SK        = process.env.STRIPE_SECRET_KEY
const SB_URL    = process.env.SUPABASE_URL
const SB_ANON   = process.env.SUPABASE_ANON_KEY
const APP_URL   = process.env.APP_URL || 'https://www.despachaapp.com.br'

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

  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const sb = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: company } = await sb.from('companies').select('stripe_customer_id').single()

  if (!company?.stripe_customer_id) {
    return json({ error: 'No subscription found' }, 404)
  }

  const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SK}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      customer:   company.stripe_customer_id,
      return_url: APP_URL,
    }),
  })
  const session = await res.json()
  if (!session.url) return json({ error: 'Failed to create portal session' }, 500)

  return json({ url: session.url })
}
