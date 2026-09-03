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

  const url = new URL(req.url)
  const p   = parseInt(url.searchParams.get('p') || '0', 10)
  const c   = url.searchParams.get('c') || ''

  if (!p || isNaN(p)) return json({ error: 'Protocolo inválido' }, 400)

  let company_id = null
  if (c) {
    const rows = await restGet(`companies?select=id&invite_code=eq.${encodeURIComponent(c)}&limit=1`)
    company_id = rows?.[0]?.id
  }
  if (!company_id) {
    const rows = await restGet('companies?select=id&limit=1')
    company_id = rows?.[0]?.id
  }

  const cols = 'id,status,needs_approval,title,description,sector,assignee,created_at,updated_at,company_id,scheduled_start,sla_deadline'
  const rows = await restGet(`tasks?select=${encodeURIComponent(cols)}&id=eq.${p}&limit=1`)
  const task = rows?.[0]

  if (!task) return json({ error: 'Protocolo não encontrado' }, 404)

  if (company_id && task.company_id !== company_id) {
    return json({ error: 'Protocolo não encontrado' }, 404)
  }

  let step, statusLabel, statusIcon, statusColor
  if (task.status === 'cancelada') {
    step = -1; statusLabel = 'Cancelado';                   statusIcon = '❌'; statusColor = '#ef4444'
  } else if (task.status === 'concluida') {
    step = 3;  statusLabel = 'Concluído';                   statusIcon = '✅'; statusColor = '#10b981'
  } else if (task.status === 'em_andamento') {
    step = 2;  statusLabel = 'Em atendimento';              statusIcon = '🔧'; statusColor = '#3b82f6'
  } else if (task.status === 'prestador_externo') {
    step = 2;  statusLabel = 'Prestador externo solicitado'; statusIcon = '🏢'; statusColor = '#7c3aed'
  } else if (task.needs_approval) {
    step = 0;  statusLabel = 'Aguardando aprovação';        statusIcon = '⏳'; statusColor = '#f59e0b'
  } else {
    step = 1;  statusLabel = 'Aguardando início do serviço'; statusIcon = '📋'; statusColor = '#8b5cf6'
  }

  return json({
    protocol:       task.id,
    status:         task.status,
    step,
    statusLabel,
    statusIcon,
    statusColor,
    title:          task.title,
    description:    task.description,
    sector:         task.sector,
    assignee:       task.assignee && task.assignee !== 'A definir' ? task.assignee : null,
    createdAt:      task.created_at,
    updatedAt:      task.updated_at,
    scheduledStart: task.scheduled_start || null,
    slaDeadline:    task.sla_deadline    || null,
  })
}
