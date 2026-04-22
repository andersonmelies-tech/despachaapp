import { useState, useEffect } from 'react'
import { fetchStats, supabase } from '../lib/supabase.js'

function fmtMin(m) {
  if (!m) return '–'
  const h = Math.floor(m / 60), mi = m % 60
  return h ? `${h}h ${mi}min` : `${mi}min`
}

function fmtDate(d) {
  if (!d) return '–'
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR')
}

export default function Dashboard({ showToast, onStatsLoaded }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pendingDates, setPendingDates] = useState([])

  async function loadPendingDates() {
    const { data } = await supabase
      .from('tasks')
      .select('id, title, assignee, due_date, provider_new_date')
      .not('provider_new_date', 'is', null)
      .not('status', 'in', '("concluida","cancelada")')
      .order('id', { ascending: false })
    setPendingDates(data || [])
  }

  async function load() {
    setLoading(true)
    const s = await fetchStats()
    setStats(s)
    if (onStatsLoaded) onStatsLoaded(s)
    await loadPendingDates()
    setLoading(false)
  }

  async function approveDate(task) {
    await supabase.from('tasks').update({ due_date: task.provider_new_date, provider_new_date: null }).eq('id', task.id)
    await supabase.from('task_history').insert({ task_id: task.id, action: 'due_date', old_value: task.due_date || '–', new_value: task.provider_new_date, changed_by: 'web' })
    showToast(`Nova data aprovada — Tarefa #${task.id} ✓`)
    loadPendingDates()
  }

  async function rejectDate(task) {
    await supabase.from('tasks').update({ provider_new_date: null }).eq('id', task.id)
    await supabase.from('task_history').insert({ task_id: task.id, action: 'provider_new_date', old_value: task.provider_new_date, new_value: 'recusado', changed_by: 'web' })
    showToast(`Nova data recusada — Tarefa #${task.id}`)
    loadPendingDates()
  }

  useEffect(() => { load() }, [])

  const s = stats || {}

  const cards = [
    { cls: 'c-total', val: s.total ?? '–',        label: 'Total' },
    { cls: 'c-pend',  val: s.pendente ?? '–',     label: 'Pendentes' },
    { cls: 'c-work',  val: s.em_andamento ?? '–', label: 'Em andamento' },
    { cls: 'c-done',  val: s.concluida ?? '–',    label: 'Concluídas' },
    { cls: 'c-late',  val: s.atrasadas ?? '–',    label: 'Atrasadas' },
    { cls: 'c-avg',   val: s.avg_minutes ? fmtMin(s.avg_minutes) : '–', label: 'Tempo médio' },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.85rem', color: 'var(--accent)' }}>
          📊 Dashboard
        </div>
        <button className="btn-sec" onClick={load}>↻ Atualizar</button>
      </div>

      {/* Alertas: novas datas aguardando aprovação */}
      {pendingDates.length > 0 && (
        <div className="pending-dates-panel">
          <div className="pending-dates-title">
            <span className="pending-dates-dot" />
            📅 {pendingDates.length} data{pendingDates.length > 1 ? 's' : ''} aguardando aprovação
          </div>
          {pendingDates.map(task => (
            <div key={task.id} className="pending-date-row">
              <div className="pending-date-info">
                <span className="pending-date-id">#{task.id}</span>
                <span className="pending-date-title">{task.title}</span>
                <span className="pending-date-provider">👤 {task.assignee}</span>
              </div>
              <div className="pending-date-dates">
                <span className="pending-date-old">{fmtDate(task.due_date)} →</span>
                <span className="pending-date-new">{fmtDate(task.provider_new_date)}</span>
              </div>
              <div className="pending-date-actions">
                <button className="btn-approve" onClick={() => approveDate(task)}>✓ Aprovar</button>
                <button className="btn-reject"  onClick={() => rejectDate(task)}>✕ Recusar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Stat cards */}
      <div className="stat-row">
        {cards.map(c => (
          <div key={c.cls} className={`scard ${c.cls}`}>
            <div className="scard-val">{loading ? '…' : c.val}</div>
            <div className="scard-label">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Provider + Sector stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {/* Por prestador */}
        <div className="cfg-card">
          <div className="cfg-title">👤 Por Prestador</div>
          {loading ? (
            <div className="empty">Carregando…</div>
          ) : (s.por_prestador || []).length === 0 ? (
            <div className="empty">Sem dados</div>
          ) : (s.por_prestador || []).map((p, i) => (
            <div key={i} style={{ padding: '.5rem 0', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '.75rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '.83rem', fontWeight: 500 }}>👤 {p.assignee}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--muted)' }}>
                  {p.total} total · {p.concluidas} ✅ · {p.andamento} 🔧 · {p.atrasadas} ⏰ · ⏱{fmtMin(p.avg_min)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Por setor */}
        <div className="cfg-card">
          <div className="cfg-title">🏢 Por Setor</div>
          {loading ? (
            <div className="empty">Carregando…</div>
          ) : (s.por_setor || []).length === 0 ? (
            <div className="empty">Sem dados</div>
          ) : (s.por_setor || []).map((sec, i) => (
            <div key={i} style={{ padding: '.5rem 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '.83rem' }}>🏢 {sec.sector}</span>
                <span className="badge">{sec.total}</span>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--muted)', marginTop: '.2rem' }}>
                {sec.concluidas} concluídas · {sec.abertas} abertas
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
