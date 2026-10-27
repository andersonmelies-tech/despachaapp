import { useState, useEffect, useRef } from 'react'
import { fetchStats, getStatsCache, supabase } from '../lib/supabase.js'
import Icon from './Icons.jsx'
import { TrendChart, Donut, Gauge, HBars, COLORS } from './Charts.jsx'

// Cache em memória (persiste enquanto componente está montado)
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

function initials(name) {
  return (name || '?').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

const CARD_CFG = [
  { key: 'total',        label: 'Total',        icon: 'list',   color: '#64748b' },
  { key: 'pendente',     label: 'Pendentes',    icon: 'clock',  color: '#d97706' },
  { key: 'em_andamento', label: 'Em andamento', icon: 'wrench', color: '#2563eb' },
  { key: 'concluida',    label: 'Concluídas',   icon: 'check',  color: '#16a34a' },
  { key: 'atrasadas',    label: 'Atrasadas',    icon: 'alert',  color: '#dc2626' },
  { key: 'avg_minutes',  label: 'Tempo médio',  icon: 'bolt',   color: '#7c3aed' },
]

const URG = [
  { key: 'critica', label: 'Crítica', color: COLORS.red },
  { key: 'alta',    label: 'Alta',    color: COLORS.warn },
  { key: 'media',   label: 'Média',   color: COLORS.blue },
  { key: 'baixa',   label: 'Baixa',   color: COLORS.green },
]

export default function Dashboard({ showToast, onStatsLoaded }) {
  // Mostra cache do sessionStorage imediatamente (evita tela em branco)
  const cached = _dc.stats || getStatsCache()
  const [stats,        setStats]        = useState(cached)
  const [loading,      setLoading]      = useState(!cached)
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
      .not('status', 'in', '("concluida","cancelada","pausada")')
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
  const total   = s.total || 0
  const aberto  = total - (s.concluida || 0)
  const taxa    = pct(s.concluida, total)
  const urg     = s.por_urgencia || {}
  const urgMax  = Math.max(1, ...URG.map(u => urg[u.key] || 0))
  const setores = s.por_setor || []
  const setMax  = Math.max(1, ...setores.map(x => x.total))
  const provs   = [...(s.por_prestador || [])]
    .map(p => ({ ...p, done: pct(p.concluidas, p.total) }))
    .sort((a, b) => b.done - a.done || b.total - a.total)
  const atencao = s.atencao || []

  return (
    <div className="dash-wrap">

      {/* ── Hero ── */}
      <div className="dash-hero">
        <div className="dash-hero-text">
          <span className="dash-hero-date">{todayFmt()}</span>
          <h1>{greeting()}! Aqui está a sua operação.</h1>
          <p>
            {loading ? 'Carregando indicadores…' : total === 0
              ? 'Nenhuma tarefa registrada ainda.'
              : <>{aberto} tarefa{aberto !== 1 ? 's' : ''} em aberto
                {s.atrasadas > 0 && <> · <b className="hero-late">{s.atrasadas} atrasada{s.atrasadas !== 1 ? 's' : ''}</b></>}
                {s.criticas > 0 && <> · <b className="hero-crit">{s.criticas} crítica{s.criticas !== 1 ? 's' : ''}</b></>}</>}
          </p>
        </div>
        <div className="dash-hero-side">
          <div className="dash-hero-rate">
            <strong>{loading ? '…' : `${taxa}%`}</strong>
            <span>taxa de conclusão</span>
          </div>
          <button className="dash-refresh" onClick={load} title="Atualizar">
            <Icon name="refresh" size={15} className={loading ? 'spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      {/* ── Alerta: datas aguardando aprovação ── */}
      {pendingDates.length > 0 && (
        <div className="dash-alert">
          <div className="dash-alert-icon"><Icon name="calendar" size={22} /></div>
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
          const p   = c.key !== 'avg_minutes' && c.key !== 'total' && total ? pct(raw, total) : null
          return (
            <div key={c.key} className="dash-kpi" style={{ '--card-color': c.color }}>
              <div className="dash-kpi-top">
                <span className="dash-kpi-label">{c.label}</span>
                <span className="dash-kpi-icon"><Icon name={c.icon} size={16} stroke={2} /></span>
              </div>
              <div className="dash-kpi-val">{loading ? '…' : val}</div>
              <div className="dash-kpi-foot">
                {c.key === 'total' && !loading && `${aberto} em aberto`}
                {c.key === 'avg_minutes' && 'por execução'}
                {p !== null && !loading && `${p}% do total`}
              </div>
              {p !== null && !loading && (
                <div className="dash-kpi-bar"><div className="dash-kpi-bar-fill" style={{ width: `${p}%` }} /></div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Fluxo + status ── */}
      <div className="dash-grid">
        <div className="dash-panel span-8">
          <div className="dash-panel-head">
            <div><div className="dash-section-title">Fluxo de demandas</div><div className="dash-section-sub">Criadas × concluídas nos últimos 14 dias</div></div>
            <div className="dash-legend">
              <span><i style={{ background: COLORS.orange }} />Criadas</span>
              <span><i style={{ background: COLORS.green }} />Concluídas</span>
            </div>
          </div>
          {loading ? <div className="dash-skeleton tall" /> : <TrendChart data={s.tendencia || []} />}
        </div>
        <div className="dash-panel span-4">
          <div className="dash-panel-head"><div><div className="dash-section-title">Status das demandas</div><div className="dash-section-sub">Distribuição atual</div></div></div>
          {loading ? <div className="dash-skeleton tall" /> : (
            <Donut
              centerValue={total} centerLabel="tarefas"
              segments={[
                { label: 'Pendentes',    value: s.pendente || 0,     color: COLORS.warn },
                { label: 'Em andamento', value: s.em_andamento || 0, color: COLORS.blue },
                { label: 'Concluídas',   value: s.concluida || 0,    color: COLORS.green },
              ]}
            />
          )}
        </div>
      </div>

      {/* ── Urgência + setores + SLA ── */}
      <div className="dash-grid">
        <div className="dash-panel span-4">
          <div className="dash-panel-head"><div><div className="dash-section-title">Abertas por urgência</div><div className="dash-section-sub">Tudo que ainda não foi concluído</div></div></div>
          <HBars rows={URG.map(u => ({ label: u.label, right: urg[u.key] || 0, max: urgMax, parts: [{ value: urg[u.key] || 0, color: u.color }] }))} />
        </div>
        <div className="dash-panel span-4">
          <div className="dash-panel-head"><div><div className="dash-section-title">Demandas por setor</div><div className="dash-section-sub">Concluídas × abertas</div></div></div>
          {loading ? <div className="dash-skeleton tall" /> : setores.length === 0 ? (
            <div className="empty">Nenhum setor com tarefas</div>
          ) : (
            <HBars rows={setores.slice(0, 6).map(x => ({
              label: x.sector, right: `${x.concluidas} ✓ · ${x.abertas} abertas`, max: setMax,
              parts: [{ value: x.concluidas, color: COLORS.green }, { value: x.abertas, color: COLORS.orange }],
            }))} />
          )}
        </div>
        <div className="dash-panel span-4">
          <div className="dash-panel-head"><div><div className="dash-section-title">Cumprimento de SLA</div><div className="dash-section-sub">Concluídas dentro do prazo</div></div></div>
          <Gauge value={s.sla_cumprido ?? null} />
        </div>
      </div>

      {/* ── Colaboradores + atenção ── */}
      <div className="dash-grid">
        <div className="dash-panel span-7">
          <div className="dash-panel-head"><div><div className="dash-section-title">Desempenho por colaborador</div><div className="dash-section-sub">Ranking por taxa de conclusão</div></div></div>
          {loading ? (
            <div className="dash-loading-rows">{[1, 2, 3].map(i => <div key={i} className="dash-skeleton" />)}</div>
          ) : provs.length === 0 ? (
            <div className="empty">Nenhum colaborador com tarefas</div>
          ) : provs.map((p, i) => {
            const col = p.done >= 70 ? COLORS.green : p.done >= 40 ? COLORS.orange : COLORS.warn
            return (
              <div key={i} className="dash-rank">
                <span className="dash-rank-pos">{i + 1}</span>
                <span className="dash-provider-avatar">{initials(p.assignee)}</span>
                <div className="dash-rank-info">
                  <div className="dash-provider-name">{p.assignee}</div>
                  <div className="dash-rank-meta">{p.total} total · {p.andamento} em curso · {p.atrasadas} atrasada{p.atrasadas !== 1 ? 's' : ''} · ⏱ {fmtMin(p.avg_min)}</div>
                  <div className="hbar-track thin"><i style={{ width: `${p.done}%`, background: col }} /></div>
                </div>
                <div className="dash-rank-pct" style={{ color: col }}>{p.done}%<small>concluído</small></div>
              </div>
            )
          })}
        </div>
        <div className="dash-panel span-5">
          <div className="dash-panel-head"><div><div className="dash-section-title">Requer atenção</div><div className="dash-section-sub">Atrasadas e críticas em aberto</div></div></div>
          {atencao.length === 0 ? (
            <div className="empty">{loading ? 'Carregando…' : 'Nada pendente de atenção 🎉'}</div>
          ) : atencao.map(t => (
            <div key={t.id} className={`dash-att${t.late ? ' late' : ''}`}>
              <div className="dash-att-main">
                <div className="dash-att-title">{t.title}</div>
                <div className="dash-att-meta">#{t.id} · {t.assignee || '–'} · prazo {fmtDate(t.due_date)}</div>
              </div>
              <span className="dash-att-tag">{t.late ? 'ATRASADA' : 'CRÍTICA'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
