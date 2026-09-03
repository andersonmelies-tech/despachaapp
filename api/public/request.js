export const config = { runtime: 'edge' }

const SB_URL     = (process.env.SUPABASE_URL          || '').trim()
const SB_SERVICE = (process.env.SUPABASE_SERVICE_KEY  || '').trim()

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...CORS }
  })
}

function svcHeaders() {
  return {
    apikey:         SB_SERVICE,
    Authorization:  `Bearer ${SB_SERVICE}`,
    'Content-Type': 'application/json',
    Prefer:         'return=representation',
  }
}

async function restGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: svcHeaders() })
  return r.ok ? r.json() : null
}

async function restPost(table, payload) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST', headers: svcHeaders(), body: JSON.stringify(payload)
  })
  const data = await r.json()
  if (!r.ok) return { data: null, error: { message: data?.message || data?.error || String(r.status) } }
  return { data: Array.isArray(data) ? data[0] : data, error: null }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')   return json({ error: 'Method not allowed' }, 405)

  let body
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }

  const { name, phone, location, requester_sector, category, description, photos, invite_code } = body

  if (!name?.trim())        return json({ error: 'Nome obrigatório' }, 400)
  if (!description?.trim()) return json({ error: 'Descrição obrigatória' }, 400)
  if (!phone?.trim())       return json({ error: 'Telefone obrigatório' }, 400)

  // Resolve company_id pelo invite_code
  let company_id = null
  if (invite_code) {
    const rows = await restGet(`companies?select=id&invite_code=eq.${encodeURIComponent(invite_code)}&limit=1`)
    company_id = rows?.[0]?.id
  }
  if (!company_id) {
    const rows = await restGet('companies?select=id&limit=1')
    company_id = rows?.[0]?.id
  }
  if (!company_id) return json({ error: 'Empresa não encontrada' }, 404)

  const title        = description.trim().slice(0, 80)
  const sla_deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const due_date     = sla_deadline.split('T')[0]
  const photosJson   = photos?.length ? JSON.stringify(photos.slice(0, 3)) : null

  const { data: task, error } = await restPost('tasks', {
    title,
    description:       description.trim(),
    requester:         name.trim(),
    requester_phone:   phone.trim(),
    requester_sector:  requester_sector?.trim() || null,
    sector:            location?.trim() || null,
    category:          category?.trim() || null,
    status:            'pendente',
    urgency:           'media',
    sla_deadline,
    due_date,
    source:            'publico',
    needs_approval:    true,
    provider_notified: false,
    company_id,
    assignee:          'A definir',
    photos:            photosJson,
  })

  if (error) {
    console.error('[public/request]', error)
    return json({ error: error.message }, 500)
  }

  return json({ ok: true, protocol: task.id })
}
