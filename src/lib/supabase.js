import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(url, key)

// ── company_id helper ────────────────────────────────────────────────────────
// Retorna o company_id da sessão ativa.
// Fallback para super admin (que não tem company_id no metadata):
// busca diretamente da tabela companies.
export async function getCompanyId() {
  const { data: { session } } = await supabase.auth.getSession()
  const fromMeta = session?.user?.user_metadata?.company_id
  if (fromMeta) return fromMeta
  // Fallback: super admin ou usuário sem company_id no metadata
  const { data } = await supabase.from('companies').select('id').limit(1).single()
  return data?.id || null
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
export const DOMAIN = '@despachaapp.internal'

export function toEmail(username) {
  // Se contém @ é um e-mail real (dono de conta) — usa como está
  // Senão é usuário interno criado pelo admin — adiciona domínio interno
  return username.includes('@') ? username : `${username.toLowerCase().trim()}${DOMAIN}`
}

export function fromEmail(email) {
  return email?.replace('@despachaapp.internal', '').replace('@despachaapp.app', '') ?? email
}

// ── SLA helpers ───────────────────────────────────────────────────────────────
const SLA_HOURS = { critica: 2, alta: 8, media: 24, baixa: 72 }

export function calcSlaDeadline(urgency, fromDate = new Date()) {
  const hours = SLA_HOURS[urgency] ?? 24
  const d = new Date(fromDate)
  d.setHours(d.getHours() + hours)
  return d.toISOString()
}

// Retorna 'YYYY-MM-DD' no fuso America/Sao_Paulo para uma string ISO
export function isoToLocalDate(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso))
}

export function isOverdue(task) {
  if (['concluida', 'cancelada', 'pendente'].includes(task.status)) return false
  const now = new Date()
  // T23:59:59 evita que o parse UTC desloque a data -3h (Brazil), tornando
  // tarefas com due_date=hoje já atrasadas desde às 21h de ontem
  const due = task.due_date ? new Date(task.due_date + 'T23:59:59') : null
  const sla = task.sla_deadline ? new Date(task.sla_deadline) : null
  return (due && due < now) || (sla && sla < now)
}

// ── Stat query ────────────────────────────────────────────────────────────────
// Seleciona APENAS as colunas necessárias para o cálculo — evita baixar
// photos (base64), description, requester_phone, etc.
const STATS_COLS = 'id,status,urgency,due_date,sla_deadline,elapsed_minutes,assignee_id,sector,recurrence_id'
const STATS_CACHE_KEY = 'dsp_stats_cache'

// Lê cache do sessionStorage (dura enquanto a aba está aberta)
export function getStatsCache() {
  try { return JSON.parse(sessionStorage.getItem(STATS_CACHE_KEY)) } catch { return null }
}
function setStatsCache(data) {
  try { sessionStorage.setItem(STATS_CACHE_KEY, JSON.stringify(data)) } catch {}
}

export async function fetchStats() {
  // Queries em paralelo — tasks + providers ao mesmo tempo
  const [{ data: tasks }, { data: provs }] = await Promise.all([
    supabase.from('tasks').select(STATS_COLS),
    supabase.from('providers').select('id,name,chat_id').eq('active', 1),
  ])
  if (!tasks) return null

  // Recorrentes futuras (due_date > hoje) não devem ser contabilizadas
  // — são geradas 60 dias à frente mas só existem "de verdade" no dia de uso
  const today = new Date().toISOString().split('T')[0]
  const tasks$ = tasks.filter(t => !t.recurrence_id || !t.due_date || t.due_date <= today)

  const total      = tasks$.length
  const pendente   = tasks$.filter(t => t.status === 'pendente').length
  const em_and     = tasks$.filter(t => t.status === 'em_andamento').length
  const concluida  = tasks$.filter(t => t.status === 'concluida').length
  const cancelada  = tasks$.filter(t => t.status === 'cancelada').length
  const atrasadas  = tasks$.filter(t => isOverdue(t)).length
  const criticas   = tasks$.filter(t => t.urgency === 'critica' && !['concluida','cancelada'].includes(t.status)).length

  const finished = tasks$.filter(t => t.elapsed_minutes)
  const avg_minutes = finished.length
    ? Math.round(finished.reduce((a, t) => a + t.elapsed_minutes, 0) / finished.length)
    : 0

  // Por prestador
  const por_prestador = (provs || []).map(p => {
    const pt = tasks$.filter(t => t.assignee_id === p.id)
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
  tasks$.forEach(t => {
    if (!t.sector) return
    if (!setorMap[t.sector]) setorMap[t.sector] = { sector: t.sector, total: 0, concluidas: 0, abertas: 0 }
    setorMap[t.sector].total++
    if (t.status === 'concluida') setorMap[t.sector].concluidas++
    else setorMap[t.sector].abertas++
  })
  const por_setor = Object.values(setorMap).sort((a,b) => b.total - a.total)

  const result = { total, pendente, em_andamento: em_and, concluida, cancelada, atrasadas, criticas, avg_minutes, por_prestador, por_setor }
  setStatsCache(result)   // salva para próxima abertura da aba
  return result
}
