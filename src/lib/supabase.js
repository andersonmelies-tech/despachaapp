import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(url, key)

// ── company_id helper ────────────────────────────────────────────────────────
// Retorna o company_id da sessão ativa. Use sempre antes de INSERTs nas tabelas
// com RLS baseada em company_id (clients, budgets, cash_flow, service_orders, etc.)
export async function getCompanyId() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user?.user_metadata?.company_id || null
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
export const DOMAIN = '@despachaapp.app'

export function toEmail(username) {
  return username.includes('@') ? username : `${username.toLowerCase().trim()}${DOMAIN}`
}

export function fromEmail(email) {
  return email?.replace(DOMAIN, '') ?? email
}

// ── SLA helpers ───────────────────────────────────────────────────────────────
const SLA_HOURS = { critica: 2, alta: 8, media: 24, baixa: 72 }

export function calcSlaDeadline(urgency, fromDate = new Date()) {
  const hours = SLA_HOURS[urgency] ?? 24
  const d = new Date(fromDate)
  d.setHours(d.getHours() + hours)
  return d.toISOString()
}

export function isOverdue(task) {
  if (['concluida', 'cancelada'].includes(task.status)) return false
  const now = new Date()
  const due = task.due_date ? new Date(task.due_date) : null
  const sla = task.sla_deadline ? new Date(task.sla_deadline) : null
  return (due && due < now) || (sla && sla < now)
}

// ── Stat query ────────────────────────────────────────────────────────────────
export async function fetchStats() {
  const now = new Date().toISOString()
  const today = new Date().toISOString().split('T')[0]

  const { data: tasks } = await supabase.from('tasks').select('*')
  if (!tasks) return null

  const total      = tasks.length
  const pendente   = tasks.filter(t => t.status === 'pendente').length
  const em_and     = tasks.filter(t => t.status === 'em_andamento').length
  const concluida  = tasks.filter(t => t.status === 'concluida').length
  const cancelada  = tasks.filter(t => t.status === 'cancelada').length
  const atrasadas  = tasks.filter(t => isOverdue(t)).length
  const criticas   = tasks.filter(t => t.urgency === 'critica' && !['concluida','cancelada'].includes(t.status)).length

  const finished = tasks.filter(t => t.elapsed_minutes)
  const avg_minutes = finished.length
    ? Math.round(finished.reduce((a, t) => a + t.elapsed_minutes, 0) / finished.length)
    : 0

  // Por prestador
  const { data: provs } = await supabase.from('providers').select('*').eq('active', 1)
  const por_prestador = (provs || []).map(p => {
    const pt = tasks.filter(t => t.assignee_id === p.id)
    const pf = pt.filter(t => t.elapsed_minutes)
    return {
      assignee: p.name,
      chat_id: p.chat_id,
      total: pt.length,
      concluidas: pt.filter(t => t.status === 'concluida').length,
      andamento: pt.filter(t => t.status === 'em_andamento').length,
      atrasadas: pt.filter(t => isOverdue(t)).length,
      avg_min: pf.length ? Math.round(pf.reduce((a,t) => a + t.elapsed_minutes, 0) / pf.length) : null
    }
  })

  // Por setor
  const setorMap = {}
  tasks.forEach(t => {
    if (!t.sector) return
    if (!setorMap[t.sector]) setorMap[t.sector] = { sector: t.sector, total: 0, concluidas: 0, abertas: 0 }
    setorMap[t.sector].total++
    if (t.status === 'concluida') setorMap[t.sector].concluidas++
    else setorMap[t.sector].abertas++
  })
  const por_setor = Object.values(setorMap).sort((a,b) => b.total - a.total)

  return { total, pendente, em_andamento: em_and, concluida, cancelada, atrasadas, criticas, avg_minutes, por_prestador, por_setor }
}
