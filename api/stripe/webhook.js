import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const SK          = process.env.STRIPE_SECRET_KEY
const WH_SECRET   = process.env.STRIPE_WEBHOOK_SECRET
const SB_URL      = process.env.SUPABASE_URL
const SB_SERVICE  = process.env.SUPABASE_SERVICE_KEY

const PLAN_MAP = {
  'price_1TPRCsGsVnzNJmCnvEK08gWJ': 'starter',
  'price_1TPRCuGsVnzNJmCnpHGEdWqL': 'pro',
  'price_1TPRCvGsVnzNJmCncqhh6auF': 'enterprise',
}

async function verifyStripeSignature(req) {
  // Simplified HMAC verification compatible with Edge Runtime
  const sig = req.headers.get('stripe-signature') || ''
  const body = await req.text()

  // Extract timestamp and signature from header
  const parts = Object.fromEntries(sig.split(',').map(p => p.split('=')))
  const timestamp = parts.t
  const expected  = parts.v1

  if (!timestamp || !expected) return { valid: false, body }

  // HMAC-SHA256 using Web Crypto
  const payload  = `${timestamp}.${body}`
  const encoder  = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(WH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig2 = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  const computed = Array.from(new Uint8Array(sig2)).map(b => b.toString(16).padStart(2,'0')).join('')

  const valid = computed === expected
  return { valid, body }
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const { valid, body } = await verifyStripeSignature(req)
  if (!valid && WH_SECRET) {
    return new Response('Invalid signature', { status: 400 })
  }

  let event
  try { event = JSON.parse(body) } catch { return new Response('Invalid JSON', { status: 400 }) }

  const sb = createClient(SB_URL, SB_SERVICE)

  const obj = event.data?.object

  switch (event.type) {
    case 'checkout.session.completed': {
      const companyId = obj.metadata?.company_id
      const plan      = obj.metadata?.plan
      const subId     = obj.subscription
      if (!companyId || !subId) break

      await sb.from('companies').update({
        stripe_subscription_id: subId,
        plan:                   plan || 'pro',
        subscription_status:    'active',
      }).eq('id', companyId)
      break
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const customerId = obj.customer
      const status     = obj.status
      const priceId    = obj.items?.data?.[0]?.price?.id
      const plan       = PLAN_MAP[priceId] || 'pro'
      const periodEnd  = obj.current_period_end
        ? new Date(obj.current_period_end * 1000).toISOString()
        : null

      const { data: company } = await sb
        .from('companies')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single()

      if (company) {
        await sb.from('companies').update({
          plan,
          subscription_status: status,
          stripe_subscription_id: obj.id,
          current_period_end: periodEnd,
        }).eq('id', company.id)
      }
      break
    }

    case 'customer.subscription.deleted': {
      const customerId = obj.customer
      const { data: company } = await sb
        .from('companies')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single()

      if (company) {
        await sb.from('companies').update({
          plan:                'trial',
          subscription_status: 'canceled',
          stripe_subscription_id: null,
        }).eq('id', company.id)
      }
      break
    }

    case 'invoice.payment_failed': {
      const customerId = obj.customer
      const { data: company } = await sb
        .from('companies')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single()

      if (company) {
        await sb.from('companies').update({ subscription_status: 'past_due' }).eq('id', company.id)
      }
      break
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  })
}
