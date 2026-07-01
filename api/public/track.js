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
    .select('id, status, needs_approval, title, description, sector, assignee, created_at, updated_at, company_id')
    .eq('id', p)
    .eq('source', 'publico')
    .maybeSingle()

  if (error || !task) return json({ error: 'Protocolo não encontrado' }, 404)

  // Verifica se pertence à mesma empresa (segurança)
  if (company_id && task.company_id !== company_id) {
    return json({ error: 'Protocolo não encontrado' }, 404)
  }

  // Deriva step e label considerando needs_approval
  let step, statusLabel, statusIcon, statusColor
  if (task.status === 'cancelada') {
    step = -1; statusLabel = 'Cancelado';                  statusIcon = '❌'; statusColor = '#ef4444'
  } else if (task.status === 'concluida') {
    step = 3;  statusLabel = 'Concluído';                  statusIcon = '✅'; statusColor = '#10b981'
  } else if (task.status === 'em_andamento') {
    step = 2;  statusLabel = 'Em atendimento';             statusIcon = '🔧'; statusColor = '#3b82f6'
  } else if (task.needs_approval) {
    step = 0;  statusLabel = 'Aguardando aprovação';       statusIcon = '⏳'; statusColor = '#f59e0b'
  } else {
    step = 1;  statusLabel = 'Aguardando início do serviço'; statusIcon = '📋'; statusColor = '#8b5cf6'
  }

  return json({
    protocol:    task.id,
    status:      task.status,
    step,
    statusLabel,
    statusIcon,
    statusColor,
    title:       task.title,
    description: task.description,
    sector:      task.sector,
    assignee:    task.assignee && task.assignee !== 'A definir' ? task.assignee : null,
    createdAt:   task.created_at,
    updatedAt:   task.updated_at,
  })
}
