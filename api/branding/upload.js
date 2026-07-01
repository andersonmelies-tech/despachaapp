export const config = { runtime: 'edge' }

import { createClient } from '@supabase/supabase-js'

async function resolveCompanyId(supabase, user) {
  const companyId = user.user_metadata?.company_id
  if (companyId) return companyId
  const { data: co } = await supabase.from('companies').select('id').limit(1).maybeSingle()
  return co?.id
}

async function verifyUser(supabase, req) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  return user
}

export default async function handler(req) {
  const supabaseUrl        = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY
  const supabase           = createClient(supabaseUrl, supabaseServiceKey)

  // GET — retorna configurações de branding da empresa (bypassa RLS via service key)
  if (req.method === 'GET') {
    const user = await verifyUser(supabase, req)
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

    const companyId = await resolveCompanyId(supabase, user)
    if (!companyId) return new Response(JSON.stringify({ error: 'company_id not found' }), { status: 400 })

    const { data: cfgRows } = await supabase
      .from('config')
      .select('key, value')
      .eq('company_id', companyId)
      .in('key', ['brand_logo_url', 'brand_primary_color', 'report_email'])

    const cfg = {}
    if (cfgRows) cfgRows.forEach(r => { cfg[r.key] = r.value })

    return new Response(JSON.stringify(cfg), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // POST — upload de logo
  if (req.method === 'POST') {
    const user = await verifyUser(supabase, req)
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

    const companyId = await resolveCompanyId(supabase, user)
    if (!companyId) return new Response(JSON.stringify({ error: 'company_id not found' }), { status: 400 })

    let file
    try {
      const formData = await req.formData()
      file = formData.get('file')
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid form data' }), { status: 400 })
    }

    if (!file || typeof file === 'string') {
      return new Response(JSON.stringify({ error: 'No file provided' }), { status: 400 })
    }

    const fileBuffer  = await file.arrayBuffer()
    const contentType = file.type || 'image/png'
    const storagePath = `${companyId}/logo`

    const { error: uploadErr } = await supabase.storage
      .from('branding')
      .upload(storagePath, fileBuffer, { contentType, upsert: true })

    if (uploadErr) {
      return new Response(JSON.stringify({ error: uploadErr.message }), { status: 500 })
    }

    const { data: urlData } = supabase.storage.from('branding').getPublicUrl(storagePath)
    const publicUrl = urlData?.publicUrl
    if (!publicUrl) return new Response(JSON.stringify({ error: 'Could not get public URL' }), { status: 500 })

    await upsertConfig(supabase, 'brand_logo_url', publicUrl, companyId)

    return new Response(JSON.stringify({ url: publicUrl }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // PUT — salva cor principal e email (bypassa RLS via service key)
  if (req.method === 'PUT') {
    const user = await verifyUser(supabase, req)
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

    const companyId = await resolveCompanyId(supabase, user)
    if (!companyId) return new Response(JSON.stringify({ error: 'company_id not found' }), { status: 400 })

    let body
    try { body = await req.json() } catch { body = {} }

    const ops = []
    if (body.brand_primary_color !== undefined) ops.push(upsertConfig(supabase, 'brand_primary_color', body.brand_primary_color, companyId))
    if (body.report_email        !== undefined) ops.push(upsertConfig(supabase, 'report_email',        body.report_email,        companyId))
    await Promise.all(ops)

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
}

async function upsertConfig(supabase, key, value, companyId) {
  // Tenta UPDATE primeiro; se não existe, INSERT
  const { data: existing } = await supabase
    .from('config')
    .select('key')
    .eq('key', key)
    .eq('company_id', companyId)
    .maybeSingle()

  if (existing) {
    return supabase.from('config').update({ value }).eq('key', key).eq('company_id', companyId)
  } else {
    return supabase.from('config').insert({ key, value, company_id: companyId })
  }
}
