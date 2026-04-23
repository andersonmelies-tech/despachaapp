export const config = { runtime: 'edge' }

import { createClient } from '@supabase/supabase-js'

export default async function handler(req) {
  const supabaseUrl        = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

  // GET — return current branding config for the authenticated user's company
  if (req.method === 'GET') {
    const authHeader = req.headers.get('authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401 })
    }
    const token = authHeader.replace('Bearer ', '')

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify user JWT
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }

    const { data: cfgRows } = await supabase
      .from('config')
      .select('key, value')
      .in('key', ['brand_logo_url', 'brand_primary_color'])

    const cfg = {}
    if (cfgRows) cfgRows.forEach(r => { cfg[r.key] = r.value })

    return new Response(JSON.stringify(cfg), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // POST — upload logo
  if (req.method === 'POST') {
    const authHeader = req.headers.get('authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401 })
    }
    const token = authHeader.replace('Bearer ', '')

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify user JWT and get company_id
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }

    // Get company_id from user metadata or profiles table
    const companyId = user.user_metadata?.company_id

    if (!companyId) {
      return new Response(JSON.stringify({ error: 'company_id not found for user' }), { status: 400 })
    }

    // Parse multipart form data
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

    // Upload to Supabase Storage bucket 'branding'
    const { error: uploadErr } = await supabase.storage
      .from('branding')
      .upload(storagePath, fileBuffer, {
        contentType,
        upsert: true,
      })

    if (uploadErr) {
      return new Response(JSON.stringify({ error: uploadErr.message }), { status: 500 })
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('branding')
      .getPublicUrl(storagePath)

    const publicUrl = urlData?.publicUrl
    if (!publicUrl) {
      return new Response(JSON.stringify({ error: 'Could not get public URL' }), { status: 500 })
    }

    // Upsert brand_logo_url in config table
    const { error: cfgErr } = await supabase
      .from('config')
      .upsert(
        { key: 'brand_logo_url', value: publicUrl, company_id: companyId },
        { onConflict: 'key,company_id' },
      )

    if (cfgErr) {
      // Non-fatal: return URL anyway
      console.error('Config upsert error:', cfgErr.message)
    }

    return new Response(JSON.stringify({ url: publicUrl }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
}
