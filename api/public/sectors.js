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
  if (req.method !== 'GET')    return json({ error: 'Method not allowed' }, 405)

  const url         = new URL(req.url)
  const invite_code = url.searchParams.get('c') || ''

  let company_id = null
  if (invite_code) {
    const rows = await restGet(`companies?select=id&invite_code=eq.${encodeURIComponent(invite_code)}&limit=1`)
    company_id = rows?.[0]?.id
  }
  if (!company_id) {
    const rows = await restGet('companies?select=id&limit=1')
    company_id = rows?.[0]?.id
  }

  if (!company_id) return json({ sectors: [] })

  const rows = await restGet(`sectors?select=id,name&company_id=eq.${encodeURIComponent(company_id)}&order=name.asc`)
  return json({ sectors: rows || [] })
}
