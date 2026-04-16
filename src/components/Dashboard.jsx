import { useState, useEffect } from 'react'
import { fetchStats } from '../lib/supabase.js'

function fmtMin(m) {
  if (!m) return '–'
  const h = Math.floor(m / 60), mi = m % 60
  return h ? `${h}h ${mi}min` : `${mi}min`
}

export default function Dashboard({ showToast, onStatsLoaded }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const s = await fetchStats()
    setStats(s)
    if (onStatsLoaded) onStatsLoaded(s)
    setLoading(false)
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
