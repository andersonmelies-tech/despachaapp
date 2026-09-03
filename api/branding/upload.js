export const config = { runtime: 'edge' }

const SB_URL     = (process.env.SUPABASE_URL          || '').trim()
const SB_ANON    = (process.env.SUPABASE_ANON_KEY     || '').trim()
const SB_SERVICE = (process.env.SUPABASE_SERVICE_KEY  || '').trim()

function svcH(extra = {}) {
  return { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...extra }
}

async function getUser(token) {
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` }
  })
  return r.ok ? r.json() : null
}

async function resolveCompanyId(user) {
  if (user.user_metadata?.company_id) return user.user_metadata.company_id
  const r = await fetch(`${SB_URL}/rest/v1/companies?select=id&limit=1`, { headers: svcH() })
  const rows = r.ok ? await r.json() : []
  return rows?.[0]?.id
}

async function upsertConfig(key, value, companyId) {
  const patchRes = await fetch(
    `${SB_URL}/rest/v1/config?key=eq.${encodeURIComponent(key)}`,
    { method: 'PATCH', headers: svcH(), body: JSON.stringify({ value, company_id: companyId }) }
  )
  const patchData = patchRes.ok ? await patchRes.json() : []
  if (!Array.isArray(patchData) || patchData.length === 0) {
    await fetch(`${SB_URL}/rest/v1/config`, {
      method: 'POST', headers: svcH(), body: JSON.stringify({ key, value, company_id: companyId })
    })
  }
}

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export default async function handler(req) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim()
  if (!token) return jsonRes({ error: 'Unauthorized' }, 401)

  const user = await getUser(token)
  if (!user?.id) return jsonRes({ error: 'Unauthorized' }, 401)

  const companyId = await resolveCompanyId(user)
  if (!companyId) return jsonRes({ error: 'company_id not found' }, 400)

  // GET — retorna configurações de branding
  if (req.method === 'GET') {
    const r = await fetch(
      `${SB_URL}/rest/v1/config?select=key,value&key=in.(brand_logo_url,brand_primary_color,report_email)&company_id=eq.${encodeURIComponent(companyId)}`,
      { headers: svcH() }
    )
    const rows = r.ok ? await r.json() : []
    const cfg  = {}
    rows.forEach(row => { cfg[row.key] = row.value })
    return jsonRes(cfg)
  }

  // POST — upload de logo via Supabase Storage REST
  if (req.method === 'POST') {
    let file
    try {
      const formData = await req.formData()
      file = formData.get('file')
    } catch { return jsonRes({ error: 'Invalid form data' }, 400) }

    if (!file || typeof file === 'string') return jsonRes({ error: 'No file provided' }, 400)

    const fileBuffer  = await file.arrayBuffer()
    const contentType = file.type || 'image/png'
    const storagePath = `${companyId}/logo`

    const uploadRes = await fetch(`${SB_URL}/storage/v1/object/branding/${storagePath}`, {
      method: 'PUT',
      headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': contentType, 'x-upsert': 'true' },
      body: fileBuffer,
    })
    if (!uploadRes.ok) {
      const e = await uploadRes.json().catch(() => ({}))
      return jsonRes({ error: e?.message || 'Upload failed' }, 500)
    }

    const publicUrl = `${SB_URL}/storage/v1/object/public/branding/${storagePath}`
    await upsertConfig('brand_logo_url', publicUrl, companyId)
    return jsonRes({ url: publicUrl })
  }

  // PUT — salva cor principal e email
  if (req.method === 'PUT') {
    let body
    try { body = await req.json() } catch { body = {} }

    const ops = []
    if (body.brand_primary_color !== undefined) ops.push(upsertConfig('brand_primary_color', body.brand_primary_color, companyId))
    if (body.report_email        !== undefined) ops.push(upsertConfig('report_email',        body.report_email,        companyId))
    await Promise.all(ops)
    return jsonRes({ ok: true })
  }

  return jsonRes({ error: 'Method not allowed' }, 405)
}
