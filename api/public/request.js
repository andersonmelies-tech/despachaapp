/**
 * DespachaApp — API pública para solicitações de serviço
 * Chamado pelo formulário público /solicitar (sem autenticação)
 * Usa service_role key para bypass de RLS
 */
import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
  if (req.method !== 'POST')   return json({ error: 'Method not allowed' }, 405)

  let body
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }

  const { name, phone, location, description, photos, invite_code } = body

  if (!name?.trim())        return json({ error: 'Nome obrigatório' }, 400)
  if (!description?.trim()) return json({ error: 'Descrição obrigatória' }, 400)
  if (!phone?.trim())       return json({ error: 'Telefone obrigatório' }, 400)

  const sb = createClient(
    process.env.SUPABASE_URL        || '',
    process.env.SUPABASE_SERVICE_KEY || ''
  )

  // Resolve company_id pelo invite_code ou pega a primeira empresa
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

  // Monta título resumido
  const title = description.trim().slice(0, 80)

  const { data: task, error } = await sb.from('tasks').insert({
    title,
    description:      description.trim(),
    requester:        name.trim(),
    requester_phone:  phone.trim(),
    client_address:   location?.trim() || null,
    status:           'pendente',
    urgency:          'media',
    source:           'publico',
    needs_approval:   true,
    provider_notified: true,   // ainda sem prestador — notifica depois da aprovação
    company_id,
    photos: photos?.length ? JSON.stringify(photos) : null,
    assignee: 'A definir',
  }).select('id').single()

  if (error) {
    console.error('[public/request]', error)
    return json({ error: error.message }, 500)
  }

  return json({ ok: true, protocol: task.id })
}
