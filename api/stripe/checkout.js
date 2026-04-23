import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const SK          = process.env.STRIPE_SECRET_KEY
const SB_URL      = process.env.SUPABASE_URL
const SB_ANON     = process.env.SUPABASE_ANON_KEY
const SB_SERVICE  = process.env.SUPABASE_SERVICE_KEY
const APP_URL     = process.env.APP_URL || 'https://despachaapp.vercel.app'

const PRICES = {
  starter:    'price_1TPRCsGsVnzNJmCnvEK08gWJ',
  pro:        'price_1TPRCuGsVnzNJmCnpHGEdWqL',
  enterprise: 'price_1TPRCvGsVnzNJmCncqhh6auF',
}

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

  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const { plan } = body
  if (!PRICES[plan]) return json({ error: 'Invalid plan. Use: starter, pro, enterprise' }, 400)

  // Busca empresa via JWT do usuário
  const sb = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: company, error } = await sb.from('companies').select('*').single()
  if (error || !company) return json({ error: 'Company not found' }, 404)

  const sbService = createClient(SB_URL, SB_SERVICE)

  // Cria ou reutiliza customer no Stripe
  let customerId = company.stripe_customer_id
  if (!customerId) {
    // metadata[key] = value é o formato correto para a API form-encoded do Stripe
    const custBody = new URLSearchParams({
      'metadata[company_id]': String(company.id),
    })
    if (company.name) custBody.set('name', company.name)

    const custRes = await fetch('https://api.stripe.com/v1/customers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SK}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: custBody,
    })
    const cust = await custRes.json()
    if (!cust.id) {
      console.error('Stripe customer error:', JSON.stringify(cust))
      return json({ error: 'Failed to create Stripe customer: ' + (cust.error?.message || 'unknown') }, 500)
    }
    customerId = cust.id
    await sbService.from('companies').update({ stripe_customer_id: customerId }).eq('id', company.id)
  }

  // Cria Checkout Session
  const params = new URLSearchParams({
    customer:                            customerId,
    'line_items[0][price]':              PRICES[plan],
    'line_items[0][quantity]':           '1',
    mode:                                'subscription',
    'metadata[company_id]':              String(company.id),
    'metadata[plan]':                    plan,
    'subscription_data[metadata][company_id]': String(company.id),
    success_url:                         `${APP_URL}/?payment=success&plan=${plan}`,
    cancel_url:                          `${APP_URL}/?payment=cancelled`,
    locale:                              'pt-BR',
    allow_promotion_codes:               'true',
  })

  const sessRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SK}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  })
  const sess = await sessRes.json()
  if (!sess.url) return json({ error: 'Failed to create checkout session', detail: sess }, 500)

  return json({ url: sess.url })
}
