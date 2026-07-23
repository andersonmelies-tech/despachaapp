import { useState, useEffect, useMemo } from 'react'
import { supabase, isOverdue } from '../lib/supabase.js'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ── Helpers ────────────────────────────────────────────────────────────────────

function getPeriodStart(period, customFrom) {
  const now = new Date()
  if (period === 'hoje') { const d = new Date(now); d.setHours(0,0,0,0); return d }
  if (period === '7d')   { const d = new Date(now); d.setDate(d.getDate() - 7);  return d }
  if (period === '30d')  { const d = new Date(now); d.setDate(d.getDate() - 30); return d }
  if (period === '90d')  { const d = new Date(now); d.setDate(d.getDate() - 90); return d }
  if (period === 'custom' && customFrom) return new Date(customFrom)
  return null
}

function monthRange(monthYear) {
  if (!monthYear) return { start: null, end: null }
  const [y, m] = monthYear.split('-').map(Number)
  const start = new Date(y, m - 1, 1)
  const end   = new Date(y, m, 0, 23, 59, 59)
  return { start, end }
}

function fmt(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function fmtHours(minutes) {
  if (!minutes) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function exportCSV(data, filename) {
  if (!data || data.length === 0) return
  const headers = Object.keys(data[0])
  const rows = data.map(row =>
    headers.map(h => {
      const v = row[h] ?? ''
      const s = String(v).replace(/"/g, '""')
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s
    }).join(',')
  )
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function taskToRow(t) {
  return {
    'ID': t.id,
    'Título': t.title || '',
    'Colaborador': t.assignee || '',
    'Setor': t.sector || '',
    'Urgência': t.urgency || '',
    'Status': t.status || '',
    'Prazo': fmt(t.due_date),
    'Criado em': fmt(t.created_at),
    'Concluído em': fmt(t.completed_at),
    'Tempo (min)': t.elapsed_minutes ?? '',
  }
}

// ── SVG Chart helpers ─────────────────────────────────────────────────────────

function polar(cx, cy, r, deg) {
  const rad = (deg - 90) * Math.PI / 180
  return [+(cx + r * Math.cos(rad)).toFixed(2), +(cy + r * Math.sin(rad)).toFixed(2)]
}

function DonutChart({ segments, size = 200 }) {
  const cx = size / 2, cy = size / 2
  const R = size * 0.42, r = size * 0.265
  const total = segments.reduce((s, d) => s + d.value, 0)
  if (total === 0) return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={(R+r)/2} fill="none" stroke="var(--border)" strokeWidth={R-r} />
      <text x={cx} y={cy+5} textAnchor="middle" fontSize="11" fill="var(--muted)">Sem dados</text>
    </svg>
  )
  let angle = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow:'visible' }}>
      {segments.filter(s => s.value > 0).map((seg, i) => {
        const sweep = (seg.value / total) * 360
        const gap = sweep > 6 ? 2.5 : 0
        const s = angle + gap, e = angle + sweep - gap
        angle += sweep
        if (e <= s + 0.1) return null
        const [x1,y1] = polar(cx,cy,R,s), [x2,y2] = polar(cx,cy,R,e)
        const [x3,y3] = polar(cx,cy,r,e), [x4,y4] = polar(cx,cy,r,s)
        const lg = (e - s) > 180 ? 1 : 0
        return <path key={i} d={`M${x1},${y1} A${R},${R} 0 ${lg},1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 ${lg},0 ${x4},${y4}Z`} fill={seg.color} />
      })}
      <text x={cx} y={cy-2} textAnchor="middle" fontSize={size*.155} fontWeight="900" fill="var(--text)" fontFamily="inherit">{total}</text>
      <text x={cx} y={cy+size*.12} textAnchor="middle" fontSize={size*.07} fill="var(--muted)" fontFamily="inherit">tarefas</text>
    </svg>
  )
}

function HalfGauge({ pct, size = 160 }) {
  // Semicírculo vai de LEFT (270° no sistema polar) até RIGHT (90°), passando pelo TOP (0°) no sentido horário
  const pad = 14
  const W   = size + pad * 2
  const cx  = W / 2
  const cy  = size * 0.52          // linha base do arco
  const R   = size * 0.40
  const sw  = size * 0.09
  const H   = cy + 24              // espaço para os labels de borda

  const cap = Math.min(Math.max(pct, 0), 100)
  const col = cap >= 80 ? '#00c896' : cap >= 50 ? '#ffb347' : '#ff4d6a'

  // Pontos fixos do arco
  const lx = cx - R, rx = cx + R  // extremo esquerdo e direito

  // 0% → 270° (LEFT), 50% → 0° (TOP), 100% → 90° (RIGHT)
  const vdeg = (270 + cap * 1.8) % 360
  const [vx, vy] = polar(cx, cy, R, vdeg)

  // large-arc=0 sempre (nunca ultrapassa 180° neste gauge)
  // sweep=1 (horário no SVG = vai para cima a partir da esquerda)
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {/* Trilha de fundo */}
      <path d={`M${lx},${cy} A${R},${R} 0 0,1 ${rx},${cy}`}
        fill="none" stroke="var(--border)" strokeWidth={sw} strokeLinecap="round" />
      {/* Arco preenchido */}
      {cap > 0 && (
        <path d={`M${lx},${cy} A${R},${R} 0 0,1 ${vx},${vy}`}
          fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round"
          style={{ WebkitPrintColorAdjust:'exact', printColorAdjust:'exact' }} />
      )}
      {/* Ponteiro */}
      <circle cx={vx} cy={vy} r={sw * 0.65} fill="white" stroke={col} strokeWidth={2.5} />
      {/* Percentual centralizado */}
      <text x={cx} y={cy - R * 0.22} textAnchor="middle"
        fontSize={size * 0.22} fontWeight="900" fill={col} fontFamily="inherit">{pct}%</text>
      {/* Labels de borda */}
      <text x={lx + sw * 0.4} y={H - 5} textAnchor="middle"
        fontSize={size * 0.063} fill="var(--muted)" fontFamily="inherit">0%</text>
      <text x={rx - sw * 0.4} y={H - 5} textAnchor="middle"
        fontSize={size * 0.063} fill="var(--muted)" fontFamily="inherit">100%</text>
    </svg>
  )
}

// ── Cabeçalho de impressão ────────────────────────────────────────────────────

function ReportPrintHeader({ periodLabel, activeFilters, tasks, companyName }) {
  const now = new Date().toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
  return (
    <div className="print-only" style={{ marginBottom: '1.8rem', fontFamily: 'Arial, sans-serif' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        paddingBottom: 10, borderBottom: '2px solid #0f2240',
        WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo.png" alt="" style={{ height: 32, objectFit: 'contain' }}
            onError={e => { e.target.style.display = 'none' }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#0f2240', letterSpacing: '.02em' }}>
              {companyName || 'DespachaApp'}
            </div>
            <div style={{ fontSize: 9, color: '#64748b', letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 1 }}>
              Gestão de Serviços
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 900, fontSize: 16, color: '#0f2240', letterSpacing: '.04em', textTransform: 'uppercase' }}>
            Relatório Operacional
          </div>
          <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 3 }}>Gerado em {now}</div>
        </div>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginTop: 8, fontSize: 10, color: '#374151',
      }}>
        <span>
          <strong>Período:</strong> {periodLabel}
          {activeFilters.length > 0 && (
            <span style={{ color: '#64748b' }}>{' '}·{' '}{activeFilters.join(' · ')}</span>
          )}
        </span>
        <span style={{ fontWeight: 700, color: '#0f2240', fontSize: 11 }}>
          {tasks.length} tarefa{tasks.length !== 1 ? 's' : ''} no período
        </span>
      </div>
    </div>
  )
}

// ── BI Dashboard ──────────────────────────────────────────────────────────────

const BI = {
  success: '#00c896', warn: '#ffb347', critical: '#ff4d6a',
  blue: '#3b6fe8', purple: '#7c6de8', gray: '#6b7a90',
}

function BIDashboard({ tasks, providers }) {
  const total      = tasks.length
  const concluidas = tasks.filter(t => t.status === 'concluida').length
  const atrasadas  = tasks.filter(t => isOverdue(t)).length
  const pendentes  = tasks.filter(t => t.status === 'pendente').length
  const emAnd      = tasks.filter(t => ['em_andamento','prestador_externo'].includes(t.status)).length
  const canceladas = tasks.filter(t => t.status === 'cancelada').length
  const cadastradas= tasks.filter(t => t.status === 'cadastrada').length

  const finished   = tasks.filter(t => t.elapsed_minutes)
  const avgMin     = finished.length ? Math.round(finished.reduce((a,t) => a + t.elapsed_minutes, 0) / finished.length) : 0

  const withSla = tasks.filter(t => t.sla_deadline && ['concluida','cancelada'].includes(t.status))
  const slaOk   = withSla.filter(t => t.completed_at && new Date(t.completed_at) <= new Date(t.sla_deadline)).length
  const slaPct  = withSla.length ? Math.round((slaOk / withSla.length) * 100) : 0
  const concPct = total ? Math.round((concluidas / total) * 100) : 0

  const statusSegs = [
    { key:'concluida',    label:'Concluídas',   value: concluidas,  color: BI.success  },
    { key:'em_andamento', label:'Em andamento',  value: emAnd,       color: BI.blue     },
    { key:'pendente',     label:'Pendentes',     value: pendentes,   color: BI.warn     },
    { key:'cadastrada',   label:'Cadastradas',   value: cadastradas, color: BI.purple   },
    { key:'cancelada',    label:'Canceladas',    value: canceladas,  color: BI.gray     },
  ]

  const urgSegs = [
    { label:'Crítica', value: tasks.filter(t => t.urgency==='critica').length, color: BI.critical },
    { label:'Alta',    value: tasks.filter(t => t.urgency==='alta').length,    color: BI.warn     },
    { label:'Média',   value: tasks.filter(t => t.urgency==='media').length,   color: BI.blue     },
    { label:'Baixa',   value: tasks.filter(t => t.urgency==='baixa').length,   color: BI.success  },
  ]
  const maxUrg = Math.max(...urgSegs.map(u => u.value), 1)

  const provRows = providers.map(p => {
    const pt   = tasks.filter(t => t.assignee_id === p.id)
    const conc = pt.filter(t => t.status === 'concluida').length
    const fin  = pt.filter(t => t.elapsed_minutes)
    const avg  = fin.length ? Math.round(fin.reduce((a,t) => a + t.elapsed_minutes, 0) / fin.length) : null
    return { id: p.id, name: p.name, total: pt.length, conc, atr: pt.filter(t => isOverdue(t)).length, avg,
      pct: pt.length ? Math.round(conc / pt.length * 100) : 0 }
  }).filter(p => p.total > 0).sort((a,b) => b.pct - a.pct || b.conc - a.conc)

  const sectorMap = {}
  tasks.forEach(t => {
    const s = t.sector || '(sem setor)'
    if (!sectorMap[s]) sectorMap[s] = { total:0, conc:0, atr:0 }
    sectorMap[s].total++
    if (t.status === 'concluida') sectorMap[s].conc++
    if (isOverdue(t)) sectorMap[s].atr++
  })
  const sectorRows = Object.entries(sectorMap)
    .map(([k,v]) => ({ sector:k, ...v, pct: v.total ? Math.round(v.conc/v.total*100) : 0 }))
    .sort((a,b) => b.total - a.total).slice(0, 8)
  const maxSec = Math.max(...sectorRows.map(r => r.total), 1)

  const kpis = [
    { label:'Total',        val: total,            suf:'',  color: BI.blue,    dot:'■' },
    { label:'Concluídas',   val: concluidas,        suf:'',  color: BI.success, dot:'■' },
    { label:'% Conclusão',  val: concPct,           suf:'%', color: concPct>=80?BI.success:concPct>=50?BI.warn:BI.critical, dot:'▲' },
    { label:'Em Execução',  val: emAnd,             suf:'',  color: BI.purple,  dot:'■' },
    { label:'Atrasadas',    val: atrasadas,         suf:'',  color: atrasadas>0?BI.critical:BI.success, dot: atrasadas>0?'▲':'■' },
    { label:'Tempo Médio',  val: fmtHours(avgMin),  suf:'',  color: '#0ea5e9',  dot:'■', mono:true },
  ]

  const medal = ['🥇','🥈','🥉']
  const pctColor = p => p >= 80 ? BI.success : p >= 50 ? BI.warn : BI.critical

  // Card style helper
  const card = (extra = {}) => ({
    background:'var(--s1)', border:'1px solid var(--border)',
    borderRadius:12, padding:'1.1rem 1.25rem', ...extra
  })
  const cardTitle = {
    fontSize:'.68rem', fontWeight:700, letterSpacing:'.1em',
    textTransform:'uppercase', color:'var(--muted)', marginBottom:'1rem',
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'.9rem' }}>

      {/* ── KPI Strip ── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'.6rem' }}>
        {kpis.map(k => (
          <div key={k.label} style={{
            ...card(), padding:'.9rem 1rem',
            borderBottom:`3px solid ${k.color}`,
          }}>
            <div style={{ fontSize:'.62rem', fontWeight:700, letterSpacing:'.09em', textTransform:'uppercase', color:'var(--muted)', marginBottom:'.45rem' }}>
              {k.label}
            </div>
            <div style={{
              fontSize:'1.85rem', fontWeight:900, color:k.color, lineHeight:1,
              fontVariantNumeric:'tabular-nums',
              fontFamily: k.mono ? 'var(--mono)' : 'inherit',
            }}>{k.val}{k.suf}</div>
          </div>
        ))}
      </div>

      {/* ── Charts Triptych ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1.15fr 1fr 0.95fr', gap:'.9rem' }}>

        {/* Status Donut */}
        <div style={card()}>
          <div style={cardTitle}>Distribuição por Status</div>
          <div style={{ display:'flex', alignItems:'center', gap:'1.1rem' }}>
            <div style={{ flexShrink:0 }}>
              <DonutChart segments={statusSegs} size={160} />
            </div>
            <div style={{ flex:1, display:'flex', flexDirection:'column', gap:'.48rem' }}>
              {statusSegs.map(s => (
                <div key={s.key} style={{ display:'flex', alignItems:'center', gap:'.5rem' }}>
                  <span style={{ width:8, height:8, borderRadius:2, background:s.color, flexShrink:0 }} />
                  <span style={{ flex:1, fontSize:'.75rem', color:'var(--text)' }}>{s.label}</span>
                  <span style={{ fontSize:'.78rem', fontWeight:800, color:s.color, fontVariantNumeric:'tabular-nums', minWidth:22, textAlign:'right' }}>{s.value}</span>
                  <span style={{ fontSize:'.65rem', color:'var(--muted)', minWidth:30, textAlign:'right' }}>
                    {total ? Math.round(s.value/total*100) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Urgency bars */}
        <div style={card()}>
          <div style={cardTitle}>Distribuição por Urgência</div>
          <div style={{ display:'flex', flexDirection:'column', gap:'.8rem' }}>
            {urgSegs.map(u => (
              <div key={u.label}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'.22rem' }}>
                  <span style={{ fontSize:'.78rem', fontWeight:600, color:'var(--text)' }}>{u.label}</span>
                  <span style={{ fontSize:'.78rem', fontWeight:800, color:u.color, fontVariantNumeric:'tabular-nums' }}>{u.value}</span>
                </div>
                <div style={{ height:10, background:'var(--s2)', borderRadius:5, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${(u.value/maxUrg)*100}%`, background:u.color, borderRadius:5,
                    WebkitPrintColorAdjust:'exact', printColorAdjust:'exact' }} />
                </div>
              </div>
            ))}
          </div>
          {(urgSegs[0].value + urgSegs[1].value) > 0 && (
            <div style={{ marginTop:'.9rem', padding:'.45rem .7rem', background:'#ff4d6a12',
              border:'1px solid #ff4d6a44', borderRadius:7, fontSize:'.72rem', color:BI.critical, fontWeight:600,
              display:'flex', alignItems:'center', gap:'.4rem' }}>
              <span>⚠</span>
              <span>{urgSegs[0].value + urgSegs[1].value} tarefas críticas / altas requerem atenção</span>
            </div>
          )}
        </div>

        {/* SLA Gauge */}
        <div style={{ ...card(), display:'flex', flexDirection:'column', alignItems:'center' }}>
          <div style={{ ...cardTitle, alignSelf:'flex-start', width:'100%' }}>Índice de SLA</div>
          <HalfGauge pct={slaPct} size={174} />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'.45rem', width:'100%', marginTop:'.6rem' }}>
            {[
              { label:'No prazo', val: slaOk,              color: BI.success  },
              { label:'Atrasadas',val: withSla.length-slaOk, color: BI.critical },
              { label:'Avaliadas', val: withSla.length,    color: 'var(--muted)' },
              { label:'Sem SLA',   val: total - withSla.length, color:'var(--muted)' },
            ].map(c => (
              <div key={c.label} style={{ textAlign:'center', padding:'.4rem .3rem', background:'var(--s2)', borderRadius:7 }}>
                <div style={{ fontSize:'1.05rem', fontWeight:900, color:c.color, fontVariantNumeric:'tabular-nums' }}>{c.val}</div>
                <div style={{ fontSize:'.6rem', color:'var(--muted)', marginTop:'.1rem', letterSpacing:'.04em' }}>{c.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Leaderboard + Sectors ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1.25fr 1fr', gap:'.9rem' }}>

        {/* Provider Leaderboard */}
        <div style={card()}>
          <div style={cardTitle}>Ranking de Colaboradores — Taxa de conclusão</div>
          {provRows.length === 0 ? (
            <div className="empty">Sem dados no período</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:'.55rem' }}>
              {provRows.slice(0,8).map((p,i) => (
                <div key={p.id} style={{ display:'flex', alignItems:'center', gap:'.7rem' }}>
                  {/* Position badge */}
                  <span style={{
                    width:24, height:24, borderRadius:6, flexShrink:0, fontSize:'.75rem', fontWeight:800,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    background: i<3 ? ['#fbbf2420','#94a3b820','#d9770620'][i] : 'var(--s2)',
                    color: i<3 ? ['#fbbf24','#94a3b8','#d97706'][i] : 'var(--muted)',
                  }}>
                    {i < 3 ? medal[i] : i+1}
                  </span>
                  {/* Name */}
                  <span style={{ flex:1, fontSize:'.8rem', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.name}</span>
                  {/* Score fraction */}
                  <span style={{ fontSize:'.7rem', color:'var(--muted)', fontVariantNumeric:'tabular-nums', minWidth:38, textAlign:'right' }}>
                    {p.conc}/{p.total}
                  </span>
                  {/* Bar */}
                  <div style={{ width:90, height:7, background:'var(--s2)', borderRadius:99, overflow:'hidden', flexShrink:0 }}>
                    <div style={{ height:'100%', width:`${p.pct}%`, background:pctColor(p.pct), borderRadius:99,
                      WebkitPrintColorAdjust:'exact', printColorAdjust:'exact' }} />
                  </div>
                  {/* Pct */}
                  <span style={{ fontSize:'.75rem', fontWeight:800, color:pctColor(p.pct), minWidth:34, textAlign:'right', fontVariantNumeric:'tabular-nums' }}>
                    {p.pct}%
                  </span>
                  {/* Overdue badge */}
                  {p.atr > 0 && (
                    <span style={{ fontSize:'.6rem', background:'#ff4d6a18', color:BI.critical, border:'1px solid #ff4d6a44',
                      borderRadius:4, padding:'1px 5px', fontWeight:700, flexShrink:0 }}>
                      {p.atr}⚠
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sector Matrix */}
        <div style={card()}>
          <div style={cardTitle}>Setores — Volume e conclusão</div>
          {sectorRows.length === 0 ? (
            <div className="empty">Sem dados</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:'.6rem' }}>
              {sectorRows.map(s => (
                <div key={s.sector}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'.18rem' }}>
                    <span style={{ fontSize:'.75rem', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1, paddingRight:8 }}>
                      {s.sector}
                    </span>
                    <span style={{ fontSize:'.7rem', color:'var(--muted)', fontVariantNumeric:'tabular-nums', flexShrink:0 }}>
                      {s.conc}/{s.total} &nbsp;
                      <span style={{ color:pctColor(s.pct), fontWeight:700 }}>{s.pct}%</span>
                    </span>
                  </div>
                  {/* Stacked bar: concluída + restante */}
                  <div style={{ height:8, background:'var(--s2)', borderRadius:4, overflow:'hidden', display:'flex' }}>
                    <div style={{ height:'100%', width:`${s.conc/maxSec*100}%`, background:BI.success,
                      WebkitPrintColorAdjust:'exact', printColorAdjust:'exact' }} />
                    {s.atr > 0 && (
                      <div style={{ height:'100%', width:`${s.atr/maxSec*100}%`, background:BI.critical,
                        WebkitPrintColorAdjust:'exact', printColorAdjust:'exact' }} />
                    )}
                  </div>
                </div>
              ))}
              {/* Legend */}
              <div style={{ display:'flex', gap:'1rem', marginTop:'.4rem' }}>
                {[['Concluídas', BI.success],['Atrasadas', BI.critical]].map(([l,c]) => (
                  <span key={l} style={{ display:'flex', alignItems:'center', gap:'.3rem', fontSize:'.65rem', color:'var(--muted)' }}>
                    <span style={{ width:8, height:8, borderRadius:2, background:c, flexShrink:0 }} />{l}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Tab 2 — Por Prestador ──────────────────────────────────────────────────────

function ProviderTab({ tasks, providers }) {
  const [sortKey, setSortKey] = useState('total')
  const [sortAsc, setSortAsc] = useState(false)

  function toggleSort(k) {
    if (sortKey === k) setSortAsc(a => !a)
    else { setSortKey(k); setSortAsc(false) }
  }

  const rows = useMemo(() => {
    const data = providers.map(p => {
      const pt = tasks.filter(t => t.assignee_id === p.id)
      const finished = pt.filter(t => t.elapsed_minutes)
      const avgMin = finished.length
        ? Math.round(finished.reduce((a,t) => a + t.elapsed_minutes, 0) / finished.length)
        : null
      const concluidas = pt.filter(t => t.status === 'concluida').length
      return {
        id: p.id,
        name: p.name,
        total: pt.length,
        concluidas,
        em_andamento: pt.filter(t => t.status === 'em_andamento').length,
        atrasadas: pt.filter(t => isOverdue(t)).length,
        avgMin,
        pct: pt.length ? Math.round((concluidas / pt.length) * 100) : 0,
      }
    })
    return [...data].sort((a,b) => {
      const av = a[sortKey] ?? -1
      const bv = b[sortKey] ?? -1
      return sortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
    })
  }, [tasks, providers, sortKey, sortAsc])

  function Th({ k, label }) {
    return (
      <th onClick={() => toggleSort(k)}>
        {label} {sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
      </th>
    )
  }

  return (
    <div className="cfg-card" style={{ overflowX: 'auto' }}>
      <div className="cfg-title" style={{ marginBottom: '.85rem' }}>👤 Desempenho por Colaborador</div>
      {rows.length === 0 ? (
        <div className="empty">Nenhum colaborador com tarefas no período</div>
      ) : (
        <table className="rep-table">
          <thead>
            <tr>
              <Th k="name"         label="Colaborador" />
              <Th k="total"        label="Total" />
              <Th k="concluidas"   label="✅ Concluídas" />
              <Th k="em_andamento" label="🔧 Andamento" />
              <Th k="atrasadas"    label="⚠️ Atrasadas" />
              <Th k="avgMin"       label="⏱ Tempo médio" />
              <Th k="pct"          label="% Conclusão" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} style={{ background: i % 2 === 0 ? 'var(--s1)' : 'var(--s2)' }}>
                <td style={{ fontWeight: 700 }}>{r.name}</td>
                <td style={{ fontFamily: 'var(--mono)', fontWeight: 600, textAlign: 'center' }}>{r.total}</td>
                <td style={{ color: '#10b981', fontFamily: 'var(--mono)', fontWeight: 600, textAlign: 'center' }}>{r.concluidas}</td>
                <td style={{ color: 'var(--blue)', fontFamily: 'var(--mono)', textAlign: 'center' }}>{r.em_andamento}</td>
                <td style={{ textAlign: 'center' }}>
                  {r.atrasadas > 0
                    ? <span style={{ background: '#fef2f2', color: '#ef4444', borderRadius: 6, padding: '2px 8px', fontWeight: 700, fontFamily: 'var(--mono)' }}>{r.atrasadas}</span>
                    : <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)' }}>0</span>}
                </td>
                <td style={{ fontFamily: 'var(--mono)', color: 'var(--muted)', textAlign: 'center' }}>{fmtHours(r.avgMin)}</td>
                <td style={{ minWidth: 130 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    <div style={{ flex: 1, height: 7, background: 'var(--s2)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${r.pct}%`, background: r.pct >= 80 ? '#10b981' : r.pct >= 50 ? '#f59e0b' : '#ef4444', borderRadius: 99, WebkitPrintColorAdjust:'exact', printColorAdjust:'exact' }} />
                    </div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', minWidth: 32, fontWeight: 700 }}>{r.pct}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Tab 3 — Por Setor ─────────────────────────────────────────────────────────

function SectorTab({ tasks }) {
  const rows = useMemo(() => {
    const map = {}
    tasks.forEach(t => {
      const s = t.sector || '(sem setor)'
      if (!map[s]) map[s] = { sector: s, total: 0, concluidas: 0, abertas: 0 }
      map[s].total++
      if (t.status === 'concluida') map[s].concluidas++
      else map[s].abertas++
    })
    return Object.values(map).sort((a,b) => b.total - a.total)
  }, [tasks])

  const maxTotal = Math.max(...rows.map(r => r.total), 1)

  return (
    <div className="cfg-card">
      <div className="cfg-title" style={{ marginBottom: '.85rem' }}>🏢 Desempenho por Setor</div>
      {rows.length === 0 ? (
        <div className="empty">Nenhuma tarefa no período</div>
      ) : (
        <>
          <table className="rep-table" style={{ marginBottom: '1.5rem' }}>
            <thead>
              <tr>
                <th>Setor</th>
                <th style={{ textAlign: 'center' }}>Total</th>
                <th style={{ textAlign: 'center' }}>✅ Concluídas</th>
                <th style={{ textAlign: 'center' }}>📋 Abertas</th>
                <th>% Conclusão</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const pct = r.total ? Math.round((r.concluidas / r.total) * 100) : 0
                return (
                  <tr key={r.sector} style={{ background: i % 2 === 0 ? 'var(--s1)' : 'var(--s2)' }}>
                    <td style={{ fontWeight: 700 }}>{r.sector}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 600, textAlign: 'center' }}>{r.total}</td>
                    <td style={{ color: '#10b981', fontFamily: 'var(--mono)', fontWeight: 600, textAlign: 'center' }}>{r.concluidas}</td>
                    <td style={{ color: '#f59e0b', fontFamily: 'var(--mono)', textAlign: 'center' }}>{r.abertas}</td>
                    <td style={{ minWidth: 130 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        <div style={{ flex: 1, height: 7, background: 'var(--s2)', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444', borderRadius: 99, WebkitPrintColorAdjust:'exact', printColorAdjust:'exact' }} />
                        </div>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', minWidth: 32, fontWeight: 700 }}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Barras de volume */}
          <div className="cfg-title" style={{ marginBottom: '.6rem' }}>Volume de tarefas por setor</div>
          {rows.map(r => (
            <div key={r.sector} style={{ display: 'flex', alignItems: 'center', gap: '.65rem', marginBottom: '.55rem' }}>
              <span style={{ minWidth: 150, fontSize: '.8rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sector}</span>
              <div style={{ flex: 1, height: 14, background: 'var(--s2)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(r.total/maxTotal)*100}%`, background: 'linear-gradient(90deg,#2563eb,#3b82f6)', borderRadius: 4, WebkitPrintColorAdjust:'exact', printColorAdjust:'exact' }} />
              </div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.82rem', fontWeight: 700, minWidth: 24, textAlign: 'right' }}>{r.total}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ── Tab 4 — Exportar ──────────────────────────────────────────────────────────

function ExportTab({ tasks, providers, period }) {
  function dlTasks() {
    exportCSV(tasks.map(taskToRow), 'tarefas.csv')
  }

  function dlDone() {
    exportCSV(tasks.filter(t => t.status === 'concluida').map(taskToRow), 'tarefas_concluidas.csv')
  }

  const [companyName, setCompanyName] = useState('DespachaApp')
  useEffect(() => {
    supabase.from('config').select('value').eq('key','company_name').single()
      .then(r => { if (r.data?.value) setCompanyName(r.data.value) })
  }, [])

  // ── PDF ──────────────────────────────────────────────────────────────────
  async function buildPDFHeader(doc, title, period) {
    const pageW = doc.internal.pageSize.getWidth()

    // Fundo do cabeçalho
    doc.setFillColor(8, 20, 38)
    doc.rect(0, 0, pageW, 38, 'F')

    // Logo (tenta carregar /icon.png como base64)
    try {
      const img = await loadImageBase64('/icon.png')
      doc.addImage(img, 'PNG', 10, 6, 26, 26)
    } catch {}

    // Nome do app
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.setTextColor(255, 255, 255)
    doc.text('DespachaApp', 40, 16)

    // Gestão de Serviços
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text('Gestão de Serviços', 40, 22)

    // Nome da empresa (direita)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(226, 232, 240)
    doc.text(companyName, pageW - 10, 16, { align: 'right' })

    // Linha separadora
    doc.setDrawColor(30, 51, 86)
    doc.setLineWidth(0.5)
    doc.line(0, 38, pageW, 38)

    // Título do relatório
    doc.setFillColor(13, 25, 41)
    doc.rect(0, 38, pageW, 18, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(226, 232, 240)
    doc.text(title, 10, 50)

    // Período + data
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    const now = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
    doc.text(`Período: ${period}   |   Gerado em: ${now}`, pageW - 10, 50, { align: 'right' })

    return 60 // Y inicial para o conteúdo
  }

  function loadImageBase64(src) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width; canvas.height = img.height
        canvas.getContext('2d').drawImage(img, 0, 0)
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = reject
      img.src = src
    })
  }

  const periodLabel = { hoje:'Hoje', '7d':'Últimos 7 dias', '30d':'Últimos 30 dias', '90d':'Últimos 90 dias', custom:'Personalizado' }

  async function exportPDF_Tasks() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const startY = await buildPDFHeader(doc, 'Relatório de Tarefas', periodLabel[period] || period)

    const rows = tasks.map(t => [
      t.id, t.title || '', t.assignee || '', t.sector || '',
      t.urgency || '', t.status?.replace('_',' ') || '',
      fmt(t.due_date), fmt(t.created_at), fmt(t.completed_at),
    ])

    autoTable(doc, {
      startY,
      head: [['#', 'Título', 'Colaborador', 'Setor', 'Urgência', 'Status', 'Prazo', 'Criado', 'Concluído']],
      body: rows,
      styles: { fontSize: 7.5, cellPadding: 2.5, textColor: [226,232,240], fillColor: [13,25,41] },
      headStyles: { fillColor: [26,51,86], textColor: [226,232,240], fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [16,31,56] },
      tableLineColor: [30,51,86], tableLineWidth: 0.2,
      didDrawPage: (data) => {
        // Footer em cada página
        const pageH = doc.internal.pageSize.getHeight()
        doc.setFontSize(7); doc.setTextColor(100,116,139)
        doc.text(`DespachaApp · ${companyName} · Página ${data.pageNumber}`, 10, pageH - 6)
        doc.text(`Confidencial`, doc.internal.pageSize.getWidth() - 10, pageH - 6, { align:'right' })
      }
    })

    doc.save(`relatorio_tarefas_${new Date().toISOString().slice(0,10)}.pdf`)
  }

  async function exportPDF_Providers() {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const startY = await buildPDFHeader(doc, 'Relatório por Colaborador', periodLabel[period] || period)

    const rows = providers.map(p => {
      const pt = tasks.filter(t => t.assignee === p.name)
      const fin = pt.filter(t => t.elapsed_minutes)
      const avgMin = fin.length ? Math.round(fin.reduce((a,t) => a + t.elapsed_minutes,0) / fin.length) : null
      const conc = pt.filter(t => t.status === 'concluida').length
      const pct = pt.length ? Math.round((conc/pt.length)*100) : 0
      return [
        p.name, p.sector || '',
        pt.length, conc,
        pt.filter(t => t.status==='em_andamento').length,
        pt.filter(t => isOverdue(t)).length,
        avgMin ? fmtHours(avgMin) : '—',
        `${pct}%`,
      ]
    })

    autoTable(doc, {
      startY,
      head: [['Colaborador','Setor','Total','Concluídas','Andamento','Atrasadas','Tempo Médio','% Conclusão']],
      body: rows,
      styles: { fontSize: 8.5, cellPadding: 3, textColor: [226,232,240], fillColor: [13,25,41] },
      headStyles: { fillColor: [26,51,86], textColor: [226,232,240], fontStyle:'bold' },
      alternateRowStyles: { fillColor: [16,31,56] },
      tableLineColor: [30,51,86], tableLineWidth: 0.2,
      didDrawPage: (data) => {
        const pageH = doc.internal.pageSize.getHeight()
        doc.setFontSize(7); doc.setTextColor(100,116,139)
        doc.text(`DespachaApp · ${companyName} · Página ${data.pageNumber}`, 10, pageH-6)
      }
    })
    doc.save(`relatorio_colaboradores_${new Date().toISOString().slice(0,10)}.pdf`)
  }

  async function exportPDF_Overview() {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const startY = await buildPDFHeader(doc, 'Visão Geral — Resumo Executivo', periodLabel[period] || period)

    const total = tasks.length
    const conc  = tasks.filter(t => t.status==='concluida').length
    const atr   = tasks.filter(t => isOverdue(t)).length
    const pend  = tasks.filter(t => t.status==='pendente').length
    const and   = tasks.filter(t => t.status==='em_andamento').length
    const fin   = tasks.filter(t => t.elapsed_minutes)
    const avgMin = fin.length ? Math.round(fin.reduce((a,t)=>a+t.elapsed_minutes,0)/fin.length) : 0

    // KPIs summary
    autoTable(doc, {
      startY,
      head: [['Métrica','Valor']],
      body: [
        ['Total de Tarefas', total],
        ['Concluídas', `${conc} (${total ? Math.round(conc/total*100) : 0}%)`],
        ['Pendentes', pend],
        ['Em Andamento', and],
        ['Atrasadas', atr],
        ['Tempo Médio de Conclusão', fmtHours(avgMin)],
      ],
      styles: { fontSize: 10, cellPadding: 4, textColor: [226,232,240], fillColor: [13,25,41] },
      headStyles: { fillColor: [26,51,86], textColor: [226,232,240], fontStyle:'bold' },
      alternateRowStyles: { fillColor: [16,31,56] },
      tableLineColor: [30,51,86], tableLineWidth: 0.2,
      columnStyles: { 0: { fontStyle:'bold' }, 1: { halign:'right' } },
      didDrawPage: (data) => {
        const pageH = doc.internal.pageSize.getHeight()
        doc.setFontSize(7); doc.setTextColor(100,116,139)
        doc.text(`DespachaApp · ${companyName} · Página ${data.pageNumber}`, 10, pageH-6)
      }
    })
    doc.save(`resumo_executivo_${new Date().toISOString().slice(0,10)}.pdf`)
  }

  // ── XML ──────────────────────────────────────────────────────────────────
  function exportXML() {
    const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    const now = new Date().toISOString()
    const lines = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<relatorio>`,
      `  <empresa>${esc(companyName)}</empresa>`,
      `  <gerado_em>${now}</gerado_em>`,
      `  <periodo>${esc(periodLabel[period] || period)}</periodo>`,
      `  <total_tarefas>${tasks.length}</total_tarefas>`,
      `  <tarefas>`,
      ...tasks.map(t => [
        `    <tarefa>`,
        `      <id>${t.id}</id>`,
        `      <titulo>${esc(t.title)}</titulo>`,
        `      <prestador>${esc(t.assignee)}</prestador>`,
        `      <setor>${esc(t.sector)}</setor>`,
        `      <urgencia>${esc(t.urgency)}</urgencia>`,
        `      <status>${esc(t.status)}</status>`,
        `      <prazo>${esc(t.due_date)}</prazo>`,
        `      <criado_em>${esc(t.created_at)}</criado_em>`,
        `      <concluido_em>${esc(t.completed_at)}</concluido_em>`,
        `      <tempo_minutos>${t.elapsed_minutes ?? ''}</tempo_minutos>`,
        `    </tarefa>`,
      ].join('\n')),
      `  </tarefas>`,
      `</relatorio>`,
    ]
    const xml = lines.join('\n')
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `relatorio_${new Date().toISOString().slice(0,10)}.xml`
    a.click(); URL.revokeObjectURL(url)
  }

  // ── CSV (mantém) ──────────────────────────────────────────────────────────
  function dlProviders() {
    const rows = providers.map(p => {
      const pt = tasks.filter(t => t.assignee === p.name)
      const fin = pt.filter(t => t.elapsed_minutes)
      const avgMin = fin.length
        ? Math.round(fin.reduce((a,t) => a + t.elapsed_minutes, 0) / fin.length) : null
      const concluidas = pt.filter(t => t.status === 'concluida').length
      return {
        'Colaborador': p.name, 'Setor': p.sector || '',
        'Total': pt.length, 'Concluídas': concluidas,
        'Em andamento': pt.filter(t => t.status==='em_andamento').length,
        'Atrasadas': pt.filter(t => isOverdue(t)).length,
        'Tempo médio (min)': avgMin ?? '',
        '% Conclusão': pt.length ? Math.round((concluidas/pt.length)*100) : 0,
      }
    })
    exportCSV(rows, 'relatorio_colaboradores.csv')
  }

  const exportGroups = [
    {
      title: '📄 PDF — Com logo e nome da empresa',
      color: '#F43F5E',
      items: [
        { label: 'Resumo Executivo',       desc: 'KPIs gerais, taxa de conclusão, tempo médio',              fn: exportPDF_Overview  },
        { label: 'Todas as Tarefas',       desc: `${tasks.length} tarefas · tabela completa (landscape)`,   fn: exportPDF_Tasks     },
        { label: 'Relatório por Colaborador',desc: `${providers.length} colaboradores com métricas de desempenho`, fn: exportPDF_Providers },
      ]
    },
    {
      title: '🗂️ XML — Para integração com sistemas',
      color: 'var(--purple)',
      items: [
        { label: 'Exportar tarefas em XML', desc: `${tasks.length} tarefas · estrutura padronizada UTF-8`, fn: exportXML },
      ]
    },
    {
      title: '📊 CSV — Para Excel e planilhas',
      color: 'var(--green)',
      items: [
        { label: 'Todas as tarefas',         desc: `${tasks.length} tarefas com todos os campos`, fn: dlTasks       },
        { label: 'Tarefas concluídas',        desc: `${tasks.filter(t=>t.status==='concluida').length} tarefas concluídas`, fn: dlDone },
        { label: 'Relatório por colaborador',   desc: `${providers.length} colaboradores com métricas`, fn: dlProviders  },
      ]
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {exportGroups.map(group => (
        <div key={group.title} className="cfg-card" style={{ borderTop: `2px solid ${group.color}` }}>
          <div className="cfg-title" style={{ color: group.color, marginBottom: '.75rem' }}>{group.title}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
            {group.items.map(b => (
              <div key={b.label} className="export-row">
                <div>
                  <div style={{ fontWeight: 600, fontSize: '.88rem' }}>{b.label}</div>
                  <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: '.15rem' }}>{b.desc}</div>
                </div>
                <button className="btn-primary" style={{ flexShrink: 0, background: group.color, border: 'none' }} onClick={b.fn}>
                  ↓ Download
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main Reports Component ─────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',  label: '📊 Visão Geral' },
  { id: 'providers', label: '👤 Por Colaborador' },
  { id: 'sectors',   label: '🏢 Por Setor' },
  { id: 'export',    label: '📤 Exportar' },
]

const PERIODS = [
  { id: 'hoje',   label: 'Hoje' },
  { id: '7d',     label: 'Últimos 7 dias' },
  { id: '30d',    label: 'Últimos 30 dias' },
  { id: '90d',    label: 'Últimos 90 dias' },
  { id: 'mes',    label: 'Por mês' },
  { id: 'custom', label: 'Personalizado' },
]

function buildMonthOpts() {
  const opts = []
  const now  = new Date()
  for (let i = 12; i >= -2; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    opts.push({ val, label: label.charAt(0).toUpperCase() + label.slice(1) })
  }
  return opts
}
const MONTH_OPTS = buildMonthOpts()
const THIS_MONTH = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2,'0')}`

const STA_OPTIONS = ['cadastrada','pendente','em_andamento','prestador_externo','concluida','cancelada']
const STA_LABELS  = { cadastrada:'Cadastrada', pendente:'Pendente', em_andamento:'Em andamento', prestador_externo:'Prestador Externo', concluida:'Concluída', cancelada:'Cancelada' }
const URG_OPTIONS = ['critica','alta','media','baixa']
const URG_LABELS  = { critica:'Crítica', alta:'Alta', media:'Média', baixa:'Baixa' }

const sel = { width:'auto', padding:'.4rem .65rem', fontSize:'.82rem' }

export default function Reports({ showToast }) {
  const [tab,          setTab]          = useState('overview')
  const [period,       setPeriod]       = useState('mes')
  const [monthYear,    setMonthYear]    = useState(THIS_MONTH)
  const [customFrom,   setCustomFrom]   = useState('')
  const [customTo,     setCustomTo]     = useState('')
  const [fSector,      setFSector]      = useState('')
  const [fProvider,    setFProvider]    = useState('')
  const [fStatus,      setFStatus]      = useState('')
  const [fUrgency,     setFUrgency]     = useState('')
  const [allTasks,     setAllTasks]     = useState([])
  const [providers,    setProviders]    = useState([])
  const [companyName,  setCompanyName]  = useState('DespachaApp')
  const [loading,      setLoading]      = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [tr, pr, cr] = await Promise.all([
        supabase.from('tasks').select('*').order('created_at', { ascending: false }),
        supabase.from('providers').select('*').eq('active', 1).order('name'),
        supabase.from('config').select('value').eq('key', 'company_name').single(),
      ])
      setAllTasks(tr.data || [])
      setProviders(pr.data || [])
      if (cr.data?.value) setCompanyName(cr.data.value)
      setLoading(false)
    }
    load()
  }, [])

  const sectors = useMemo(() =>
    [...new Set(allTasks.map(t => t.sector).filter(Boolean))].sort()
  , [allTasks])

  const tasks = useMemo(() => {
    let start, end
    if (period === 'mes') {
      const r = monthRange(monthYear)
      start = r.start; end = r.end
    } else {
      start = getPeriodStart(period, customFrom)
      end   = period === 'custom' && customTo ? new Date(customTo + 'T23:59:59') : null
    }

    return allTasks.filter(t => {
      // Tarefas recorrentes: filtrar pela data de execução (due_date)
      // Tarefas normais: filtrar pela data de criação (created_at)
      const refDate = t.recurrence_id && t.due_date ? t.due_date + 'T12:00:00' : t.created_at
      const d = new Date(refDate)
      if (start && d < start) return false
      if (end   && d > end)   return false
      if (fSector   && t.sector      !== fSector)             return false
      if (fProvider && String(t.assignee_id) !== fProvider)   return false
      if (fStatus   && t.status      !== fStatus)             return false
      if (fUrgency  && t.urgency     !== fUrgency)            return false
      return true
    })
  }, [allTasks, period, monthYear, customFrom, customTo, fSector, fProvider, fStatus, fUrgency])

  const hasFilter = fSector || fProvider || fStatus || fUrgency
  function clearFilters() { setFSector(''); setFProvider(''); setFStatus(''); setFUrgency('') }

  const monthLabel = MONTH_OPTS.find(o => o.val === monthYear)?.label || monthYear
  const periodLabel = {
    hoje:'Hoje', '7d':'Últimos 7 dias', '30d':'Últimos 30 dias', '90d':'Últimos 90 dias',
    mes: monthLabel, custom:'Personalizado',
  }
  const activeFilters = [
    fSector   && `Setor: ${fSector}`,
    fProvider && `Colaborador: ${providers.find(p=>String(p.id)===fProvider)?.name}`,
    fStatus   && `Status: ${STA_LABELS[fStatus]}`,
    fUrgency  && `Urgência: ${URG_LABELS[fUrgency]}`,
  ].filter(Boolean)

  return (
    <div>
      {/* ── Cabeçalho de impressão (oculto na tela) ── */}
      <ReportPrintHeader
        periodLabel={periodLabel[period] || period}
        activeFilters={activeFilters}
        tasks={tasks}
        companyName={companyName}
      />

      {/* ── Header da tela ── */}
      <div className="no-print" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'.75rem', flexWrap:'wrap', gap:'.65rem' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'.65rem' }}>
          <img src="/logo.png" alt="DespachaApp"
            style={{ height:28, objectFit:'contain' }}
            onError={e => { e.target.style.display='none' }} />
          <h2 style={{ fontFamily:'var(--mono)', fontSize:'1rem', color:'var(--blue)', letterSpacing:'.04em', margin:0 }}>
            📊 RELATÓRIOS
          </h2>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'.5rem', flexWrap:'wrap' }}>
          <button
            onClick={() => window.print()}
            style={{ padding:'.4rem .85rem', fontSize:'.82rem', background:'#0f2240', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontWeight:600 }}
          >🖨️ Imprimir</button>
          <span style={{ fontSize:'.78rem', color:'var(--muted)', fontFamily:'var(--mono)' }}>
            {tasks.length} tarefa{tasks.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="no-print cfg-card" style={{ marginBottom:'1rem', display:'flex', flexWrap:'wrap', gap:'.6rem', alignItems:'center' }}>
        {/* Período */}
        <select className="finput" style={sel} value={period} onChange={e => setPeriod(e.target.value)}>
          {PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {period === 'mes' && (
          <select className="finput" style={{ ...sel, minWidth: 160 }} value={monthYear} onChange={e => setMonthYear(e.target.value)}>
            {MONTH_OPTS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
          </select>
        )}
        {period === 'custom' && (<>
          <input type="date" className="finput" style={sel} value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
          <span style={{ color:'var(--muted)', fontSize:'.82rem' }}>até</span>
          <input type="date" className="finput" style={sel} value={customTo}   onChange={e => setCustomTo(e.target.value)} />
        </>)}

        <div style={{ width:1, height:24, background:'var(--border)', flexShrink:0 }} />

        {/* Setor */}
        <select className="finput" style={sel} value={fSector} onChange={e => setFSector(e.target.value)}>
          <option value="">Todos os setores</option>
          {sectors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Colaborador */}
        <select className="finput" style={sel} value={fProvider} onChange={e => setFProvider(e.target.value)}>
          <option value="">Todos os colaboradores</option>
          {providers.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
        </select>

        {/* Status */}
        <select className="finput" style={sel} value={fStatus} onChange={e => setFStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {STA_OPTIONS.map(s => <option key={s} value={s}>{STA_LABELS[s]}</option>)}
        </select>

        {/* Urgência */}
        <select className="finput" style={sel} value={fUrgency} onChange={e => setFUrgency(e.target.value)}>
          <option value="">Todas as urgências</option>
          {URG_OPTIONS.map(u => <option key={u} value={u}>{URG_LABELS[u]}</option>)}
        </select>

        {hasFilter && (
          <button onClick={clearFilters} style={{ padding:'.4rem .75rem', fontSize:'.78rem', background:'#fef2f2', color:'var(--red)', border:'1px solid #fca5a5', borderRadius:6, cursor:'pointer', fontWeight:600 }}>
            ✕ Limpar filtros
          </button>
        )}
      </div>

      {/* Resumo dos filtros ativos — aparece na impressão */}
      {activeFilters.length > 0 && (
        <div style={{ fontSize:'.78rem', color:'var(--muted)', marginBottom:'.75rem', display:'flex', gap:'.5rem', flexWrap:'wrap' }}>
          <span style={{ fontWeight:600, color:'var(--text)' }}>Filtros:</span>
          {activeFilters.map(f => (
            <span key={f} style={{ background:'var(--s2)', padding:'.15rem .55rem', borderRadius:20, border:'1px solid var(--border)' }}>{f}</span>
          ))}
          <span>· Período: {periodLabel[period] || period}</span>
          <span>· {tasks.length} tarefa{tasks.length !== 1?'s':''}</span>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="stab-bar no-print" style={{ marginBottom:'1.25rem' }}>
        {TABS.map(t => (
          <button key={t.id} className={`stab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="empty">Carregando dados…</div>
      ) : (
        <>
          {tab === 'overview'  && <BIDashboard  tasks={tasks} providers={providers} />}
          {tab === 'providers' && <ProviderTab  tasks={tasks} providers={providers} />}
          {tab === 'sectors'   && <SectorTab    tasks={tasks} />}
          {tab === 'export'    && <ExportTab    tasks={tasks} providers={providers} period={period} />}
        </>
      )}
    </div>
  )
}
