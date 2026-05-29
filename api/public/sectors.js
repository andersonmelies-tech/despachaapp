/**
 * DespachaApp — Lista setores da empresa pelo invite_code
 * Usado pelo formulário público /solicitar sem autenticação
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
  if (req.method !== 'GET')    return json({ error: 'Method not allowed' }, 405)

  const url         = new URL(req.url)
  const invite_code = url.searchParams.get('c') || ''

  const sb = createClient(
    process.env.SUPABASE_URL         || '',
    process.env.SUPABASE_SERVICE_KEY || ''
  )

  // Resolve company_id pelo invite_code
  let company_id = null
  if (invite_code) {
    const { data: co } = await sb.from('companies').select('id')
      .eq('invite_code', invite_code).eq('active', true).maybeSingle()
    company_id = co?.id
  }
  if (!company_id) {
    const { data: co } = await sb.from('companies').select('id').limit(1).maybeSingle()
    company_id = co?.id
  }

  if (!company_id) return json({ sectors: [] })

  const { data, error } = await sb
    .from('sectors')
    .select('id, name')
    .eq('company_id', company_id)
    .order('name')

  if (error) return json({ sectors: [] })

  return json({ sectors: data || [] })
}
