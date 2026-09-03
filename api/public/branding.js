export const config = { runtime: 'edge' }

const SB_URL     = (process.env.SUPABASE_URL          || '').trim()
const SB_SERVICE = (process.env.SUPABASE_SERVICE_KEY  || '').trim()

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...CORS }
  })
}

function svcHeaders() {
  return { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` }
}

async function restGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: svcHeaders() })
  return r.ok ? r.json() : null
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const url  = new URL(req.url)
  const code = url.searchParams.get('c') || ''

  let company_id = null
  if (code) {
    const rows = await restGet(`companies?select=id&invite_code=eq.${encodeURIComponent(code)}&limit=1`)
    company_id = rows?.[0]?.id
  }
  if (!company_id) {
    const rows = await restGet('companies?select=id&limit=1')
    company_id = rows?.[0]?.id
  }

  let cfg = []
  if (company_id) {
    cfg = await restGet(
      `config?select=key,value&key=in.(brand_logo_url,brand_primary_color,brand_company_name)&company_id=eq.${encodeURIComponent(company_id)}`
    ) || []
  } else {
    cfg = await restGet(
      `config?select=key,value&key=in.(brand_logo_url,brand_primary_color,brand_company_name)`
    ) || []
  }

  const brand = Object.fromEntries(cfg.map(r => [r.key, r.value]))

  return json({
    logo_url:      brand.brand_logo_url      || null,
    primary_color: brand.brand_primary_color || '#2563eb',
    company_name:  brand.brand_company_name  || null,
  })
}
