import { useState, useEffect, useRef } from 'react'
import { fetchStats, supabase } from '../lib/supabase.js'
import { cacheGet, cacheSet } from '../lib/cache.js'

const _dc = { stats: null, dates: [], loaded: false }

function fmtMin(m) {
  if (!m) return '–'
  const h = Math.floor(m / 60), mi = m % 60
  return h ? `${h}h ${mi}min` : `${mi}min`
}

function fmtDate(d) {
  if (!d) return '–'
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR')
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

function todayFmt() {
  return new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function pct(part, total) {
  if (!total) return 0
  return Math.round((part / total) * 100)
}

const CARD_CFG = [
  { key: 'total',        label: 'Total',        icon: '📋', cls: 'c-total', color: 'var(--gray)'   },
  { key: 'pendente',     label: 'Pendentes',    icon: '⏳', cls: 'c-pend',  color: 'var(--warn)'   },
  { key: 'em_andamento', label: 'Em andamento', icon: '⚡', cls: 'c-work',  color: 'var(--blue)'   },
  { key: 'concluida',    label: 'Concluídas',   icon: '✅', cls: 'c-done',  color: 'var(--green)'  },
  { key: 'atrasadas',    label: 'Atrasadas',    icon: '🔴', cls: 'c-late',  color: 'var(--red)'    },
  { key: 'avg_minutes',  label: 'Tempo médio',  icon: '⏱️', cls: 'c-avg',   color: 'var(--yellow)' },
]

export default function Dashboard({ showToast, onStatsLoaded }) {
  const [stats,        setStats]        = useState(_dc.stats)
  const [loading,      setLoading]      = useState(!_dc.loaded)
  const [pendingDates, setPendingDates] = useState(_dc.dates)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  async function loadPendingDates() {
    const { data } = await supabase
      .from('tasks')
      .select('id, title, assignee, due_date, provider_new_date')
      .not('provider_new_date', 'is', null)
      .not('status', 'in', '("concluida","cancelada")')
      .order('id', { ascending: false })
    if (!mountedRef.current) return
    _dc.dates = data || []
    setPendingDates(_dc.dates)
  }

  async function load() {
    if (!_dc.loaded) setLoading(true)
    const s = await fetchStats()
    if (!mountedRef.current) return
    _dc.stats  = s
    _dc.loaded = true
    setStats(s)
    setLoading(false)
    if (onStatsLoaded) onStatsLoaded(s)
    await loadPendingDates()
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

  useEffect(() => {
    load()

    // ── Realtime: stats e alertas se atualizam automaticamente ───────────────
    // Usa debounce simples: aguarda 800ms após o último evento antes de recarregar
    let debounce = null
    const ch = supabase.channel('rt-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        if (!mountedRef.current) return
        clearTimeout(debounce)
        debounce = setTimeout(() => {
          if (!mountedRef.current) return
          _dc.loaded = false   // força re-fetch silencioso
          load()
        }, 800)
      })
      .subscribe()

    return () => {
      clearTimeout(debounce)
      supabase.removeChannel(ch)
    }
  }, [])

  const s = stats || {}
  const total = s.total || 0

  return (
    <div className="dash-wrap">

      {/* ── Header ── */}
      <div className="dash-header">
        <div className="dash-greeting">
          <span className="dash-greeting-hi">{greeting()} 👋</span>
          <span className="dash-greeting-date">{todayFmt()}</span>
        </div>
        <button className="dash-refresh" onClick={load} title="Atualizar">
          <span className={loading ? 'spin' : ''}>↻</span> Atualizar
        </button>
      </div>

      {/* ── Alerta: datas aguardando aprovação ── */}
      {pendingDates.length > 0 && (
        <div className="dash-alert">
          <div className="dash-alert-icon">📅</div>
          <div className="dash-alert-body">
            <div className="dash-alert-title">
              {pendingDates.length} data{pendingDates.length > 1 ? 's' : ''} aguardando sua aprovação
            </div>
            <div className="dash-alert-rows">
              {pendingDates.map(task => (
                <div key={task.id} className="dash-alert-row">
                  <span className="dash-alert-id">#{task.id}</span>
                  <span className="dash-alert-taskname">{task.title}</span>
                  <span className="dash-alert-provider">👤 {task.assignee}</span>
                  <span className="dash-alert-dates">
                    <span className="dash-date-old">{fmtDate(task.due_date)}</span>
                    <span className="dash-date-arrow">→</span>
                    <span className="dash-date-new">{fmtDate(task.provider_new_date)}</span>
                  </span>
                  <div className="dash-alert-btns">
                    <button className="dash-btn-approve" onClick={() => approveDate(task)}>✓ Aprovar</button>
                    <button className="dash-btn-reject"  onClick={() => rejectDate(task)}>✕ Recusar</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div className="dash-kpi-grid">
        {CARD_CFG.map(c => {
          const raw = s[c.key]
          const val = c.key === 'avg_minutes' ? fmtMin(raw) : (raw ?? '–')
          const p   = c.key !== 'avg_minutes' && total ? pct(raw, total) : null
          return (
            <div key={c.key} className={`dash-kpi ${c.cls}`} style={{ '--card-color': c.color }}>
              <div className="dash-kpi-top">
                <span className="dash-kpi-icon">{c.icon}</span>
                {p !== null && <span className="dash-kpi-pct">{loading ? '…' : `${p}%`}</span>}
              </div>
              <div className="dash-kpi-val">{loading ? '…' : val}</div>
              <div className="dash-kpi-label">{c.label}</div>
              {p !== null && !loading && (
                <div className="dash-kpi-bar">
                  <div className="dash-kpi-bar-fill" style={{ width: `${p}%`, background: c.color }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Distribuição visual ── */}
      {!loading && total > 0 && (
        <div className="dash-dist-card">
          <div className="dash-section-title">📊 Distribuição de tarefas</div>
          <div className="dash-dist-bar">
            {[
              { key: 'concluida',    color: 'var(--green)', label: 'Concluídas' },
              { key: 'em_andamento', color: 'var(--blue)',  label: 'Em andamento' },
              { key: 'pendente',     color: 'var(--warn)',  label: 'Pendentes' },
              { key: 'atrasadas',    color: 'var(--red)',   label: 'Atrasadas' },
            ].map(item => {
              const p = pct(s[item.key], total)
              return p > 0 ? (
                <div
                  key={item.key}
                  className="dash-dist-segment"
                  style={{ width: `${p}%`, background: item.color }}
                  title={`${item.label}: ${s[item.key]} (${p}%)`}
                />
              ) : null
            })}
          </div>
          <div className="dash-dist-legend">
            {[
              { key: 'concluida',    color: 'var(--green)', label: 'Concluídas' },
              { key: 'em_andamento', color: 'var(--blue)',  label: 'Em andamento' },
              { key: 'pendente',     color: 'var(--warn)',  label: 'Pendentes' },
              { key: 'atrasadas',    color: 'var(--red)',   label: 'Atrasadas' },
            ].map(item => (
              <div key={item.key} className="dash-dist-legend-item">
                <span className="dash-dist-dot" style={{ background: item.color }} />
                <span>{item.label}</span>
                <strong>{s[item.key] || 0}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Grid inferior: prestadores + setores ── */}
      <div className="dash-bottom-grid">

        {/* Por Prestador */}
        <div className="dash-panel">
          <div className="dash-section-title">👤 Desempenho por Colaborador</div>
          {loading ? (
            <div className="dash-loading-rows">
              {[1,2,3].map(i => <div key={i} className="dash-skeleton" />)}
            </div>
          ) : (s.por_prestador || []).length === 0 ? (
            <div className="empty">Nenhum colaborador com tarefas</div>
          ) : (s.por_prestador || []).map((p, i) => {
            const done = pct(p.concluidas, p.total)
            const late = pct(p.atrasadas, p.total)
            return (
              <div key={i} className="dash-provider-row">
                <div className="dash-provider-avatar">
                  {(p.assignee || '?')[0].toUpperCase()}
                </div>
                <div className="dash-provider-info">
                  <div className="dash-provider-name">{p.assignee}</div>
                  <div className="dash-provider-stats">
                    <span className="dash-pstat green">✅ {p.concluidas}</span>
                    <span className="dash-pstat blue">⚡ {p.andamento}</span>
                    <span className="dash-pstat red">⏰ {p.atrasadas}</span>
                    <span className="dash-pstat muted">⏱ {fmtMin(p.avg_min)}</span>
                  </div>
                  <div className="dash-provider-bar">
                    <div className="dash-provider-bar-done"  style={{ width: `${done}%` }} />
                    <div className="dash-provider-bar-late"  style={{ width: `${late}%` }} />
                  </div>
                </div>
                <div className="dash-provider-total">{p.total}</div>
              </div>
            )
          })}
        </div>

        {/* Por Setor */}
        <div className="dash-panel">
          <div className="dash-section-title">🏢 Tarefas por Setor</div>
          {loading ? (
            <div className="dash-loading-rows">
              {[1,2,3].map(i => <div key={i} className="dash-skeleton" />)}
            </div>
          ) : (s.por_setor || []).length === 0 ? (
            <div className="empty">Nenhum setor com tarefas</div>
          ) : (s.por_setor || []).map((sec, i) => {
            const maxVal = Math.max(...(s.por_setor || []).map(x => x.total))
            const barW = pct(sec.total, maxVal)
            const donePct = pct(sec.concluidas, sec.total)
            return (
              <div key={i} className="dash-sector-row">
                <div className="dash-sector-header">
                  <span className="dash-sector-name">{sec.sector}</span>
                  <div className="dash-sector-badges">
                    <span className="dash-sbadge green">{sec.concluidas} ✓</span>
                    <span className="dash-sbadge warn">{sec.abertas} abertas</span>
                    <span className="dash-sbadge total">{sec.total}</span>
                  </div>
                </div>
                <div className="dash-sector-bar-wrap">
                  <div className="dash-sector-bar-fill" style={{ width: `${barW}%` }}>
                    <div className="dash-sector-bar-done" style={{ width: `${donePct}%` }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

      </div>
    </div>
  )
}
