/**
 * Retorna branding público da empresa pelo invite_code
 * Usado pelos formulários públicos para aplicar logo + cores da empresa
 */
import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const url  = new URL(req.url)
  const code = url.searchParams.get('c') || ''

  const sb = createClient(
    process.env.SUPABASE_URL         || '',
    process.env.SUPABASE_SERVICE_KEY || ''
  )

  let company_id = null
  if (code) {
    const { data: co } = await sb.from('companies').select('id,name')
      .eq('invite_code', code).eq('active', true).maybeSingle()
    company_id = co?.id
  }
  if (!company_id) {
    const { data: co } = await sb.from('companies').select('id,name').limit(1).maybeSingle()
    company_id = co?.id
  }

  const { data: cfg } = await sb.from('config')
    .select('key,value')
    .in('key', ['brand_logo_url', 'brand_primary_color', 'brand_company_name'])

  const brand = Object.fromEntries((cfg || []).map(r => [r.key, r.value]))

  return json({
    logo_url:     brand.brand_logo_url     || null,
    primary_color: brand.brand_primary_color || '#2563eb',
    company_name:  brand.brand_company_name  || null,
  })
}
