/**
 * DespachaApp — Consulta pública de protocolo
 * GET /api/public/track?p=PROTOCOL_ID&c=INVITE_CODE
 * Retorna apenas informações seguras (sem telefone, fotos, etc.)
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

const STATUS_LABEL = {
  pendente:     { label: 'Aguardando atendimento', icon: '⏳', color: '#f59e0b' },
  em_andamento: { label: 'Em atendimento',          icon: '🔧', color: '#3b82f6' },
  concluida:    { label: 'Concluído',               icon: '✅', color: '#10b981' },
  cancelada:    { label: 'Cancelado',               icon: '❌', color: '#ef4444' },
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'GET')    return json({ error: 'Method not allowed' }, 405)

  const url  = new URL(req.url)
  const p    = parseInt(url.searchParams.get('p') || '0', 10)
  const c    = url.searchParams.get('c') || ''

  if (!p || isNaN(p)) return json({ error: 'Protocolo inválido' }, 400)

  const sb = createClient(
    process.env.SUPABASE_URL         || '',
    process.env.SUPABASE_SERVICE_KEY || ''
  )

  // Resolve company pelo invite_code (ou pega a primeira)
  let company_id = null
  if (c) {
    const { data: co } = await sb.from('companies').select('id')
      .eq('invite_code', c).eq('active', true).maybeSingle()
    company_id = co?.id
  }
  if (!company_id) {
    const { data: co } = await sb.from('companies').select('id').limit(1).maybeSingle()
    company_id = co?.id
  }

  const { data: task, error } = await sb
    .from('tasks')
    .select('id, status, title, description, sector, assignee, created_at, updated_at, company_id')
    .eq('id', p)
    .eq('source', 'publico')
    .maybeSingle()

  if (error || !task) return json({ error: 'Protocolo não encontrado' }, 404)

  // Verifica se pertence à mesma empresa (segurança)
  if (company_id && task.company_id !== company_id) {
    return json({ error: 'Protocolo não encontrado' }, 404)
  }

  const st = STATUS_LABEL[task.status] || STATUS_LABEL.pendente

  return json({
    protocol:    task.id,
    status:      task.status,
    statusLabel: st.label,
    statusIcon:  st.icon,
    statusColor: st.color,
    title:       task.title,
    description: task.description,
    sector:      task.sector,
    assignee:    task.assignee && task.assignee !== 'A definir' ? task.assignee : null,
    createdAt:   task.created_at,
    updatedAt:   task.updated_at,
  })
}
