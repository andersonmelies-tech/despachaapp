import { useState, useEffect, useMemo } from 'react'
import { supabase, isOverdue } from '../lib/supabase.js'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import Icon from './Icons.jsx'
import { Donut, Gauge, HBars, COLORS } from './Charts.jsx'

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
  success: COLORS.green, warn: COLORS.warn, critical: COLORS.red,
  blue: COLORS.blue, purple: COLORS.purple, gray: COLORS.gray,
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

  const pctColor = p => p >= 80 ? COLORS.green : p >= 50 ? COLORS.orange : COLORS.red

  const kpis = [
    { label: 'Total',       val: total,           suf: '',  color: '#64748b', icon: 'list',   foot: 'no período selecionado' },
    { label: 'Concluídas',  val: concluidas,      suf: '',  color: '#16a34a', icon: 'check',  foot: `de ${total} tarefas` },
    { label: 'Conclusão',   val: concPct,         suf: '%', color: pctColor(concPct), icon: 'reports', foot: 'concluídas sobre o total' },
    { label: 'Em execução', val: emAnd,           suf: '',  color: '#2563eb', icon: 'wrench', foot: 'em andamento ou externo' },
    { label: 'Atrasadas',   val: atrasadas,       suf: '',  color: atrasadas > 0 ? '#dc2626' : '#16a34a', icon: 'alert', foot: atrasadas > 0 ? 'fora do prazo ou SLA' : 'tudo no prazo' },
    { label: 'Tempo médio', val: fmtHours(avgMin), suf: '', color: '#7c3aed', icon: 'bolt',   foot: 'por tarefa concluída' },
  ]
  const urgAtencao = urgSegs[0].value + urgSegs[1].value

  return (
    <div className="rep-stack">

      <div className="dash-kpi-grid">
        {kpis.map(k => (
          <div key={k.label} className="dash-kpi" style={{ '--card-color': k.color }}>
            <div className="dash-kpi-top">
              <span className="dash-kpi-label">{k.label}</span>
              <span className="dash-kpi-icon"><Icon name={k.icon} size={16} stroke={2} /></span>
            </div>
            <div className="dash-kpi-val">{k.val}{k.suf}</div>
            <div className="dash-kpi-foot">{k.foot}</div>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        <div className="dash-panel span-4">
          <div className="dash-panel-head"><div><div className="dash-section-title">Distribuição por status</div><div className="dash-section-sub">Todas as tarefas do período</div></div></div>
          <Donut
            centerValue={total} centerLabel="tarefas"
            segments={statusSegs.map(s => ({ label: s.label, value: s.value, color: s.color }))}
          />
        </div>

        <div className="dash-panel span-4">
          <div className="dash-panel-head"><div><div className="dash-section-title">Distribuição por urgência</div><div className="dash-section-sub">Inclui tarefas já concluídas</div></div></div>
          <HBars rows={urgSegs.map(u => ({ label: u.label, right: u.value, max: maxUrg, parts: [{ value: u.value, color: u.color }] }))} />
          {urgAtencao > 0 && (
            <div className="rep-callout">
              <Icon name="alert" size={15} />
              {urgAtencao} tarefa{urgAtencao !== 1 ? 's' : ''} crítica{urgAtencao !== 1 ? 's' : ''} ou de urgência alta
            </div>
          )}
        </div>

        <div className="dash-panel span-4">
          <div className="dash-panel-head"><div><div className="dash-section-title">Cumprimento de SLA</div><div className="dash-section-sub">Tarefas encerradas dentro do prazo</div></div></div>
          <Gauge value={withSla.length ? slaPct : null} />
          <div className="rep-tiles">
            {[
              { label: 'No prazo',  val: slaOk,                  color: COLORS.green },
              { label: 'Fora do prazo', val: withSla.length - slaOk, color: COLORS.red },
              { label: 'Avaliadas', val: withSla.length,         color: '#0f172a' },
              { label: 'Sem SLA',   val: total - withSla.length, color: '#64748b' },
            ].map(c => (
              <div key={c.label}><strong style={{ color: c.color }}>{c.val}</strong><span>{c.label}</span></div>
            ))}
          </div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="dash-panel span-7">
          <div className="dash-panel-head"><div><div className="dash-section-title">Ranking de colaboradores</div><div className="dash-section-sub">Taxa de conclusão no período</div></div></div>
          {provRows.length === 0 ? (
            <div className="empty">Sem dados no período</div>
          ) : provRows.slice(0, 8).map((p, i) => (
            <div key={p.id} className="dash-rank">
              <span className="dash-rank-pos">{i + 1}</span>
              <span className="dash-provider-avatar">{initials(p.name)}</span>
              <div className="dash-rank-info">
                <div className="dash-provider-name">{p.name}</div>
                <div className="dash-rank-meta">{p.conc} de {p.total} concluídas{p.atr > 0 ? ` · ${p.atr} atrasada${p.atr !== 1 ? 's' : ''}` : ''}{p.avg ? ` · ${fmtHours(p.avg)} em média` : ''}</div>
                <div className="hbar-track thin"><i style={{ width: `${p.pct}%`, background: pctColor(p.pct) }} /></div>
              </div>
              <div className="dash-rank-pct" style={{ color: pctColor(p.pct) }}>{p.pct}%<small>concluído</small></div>
            </div>
          ))}
        </div>

        <div className="dash-panel span-5">
          <div className="dash-panel-head">
            <div><div className="dash-section-title">Setores</div><div className="dash-section-sub">Volume e conclusão</div></div>
            <div className="dash-legend">
              <span><i style={{ background: COLORS.green }} />Concluídas</span>
              <span><i style={{ background: COLORS.red }} />Atrasadas</span>
            </div>
          </div>
          {sectorRows.length === 0 ? (
            <div className="empty">Sem dados</div>
          ) : (
            <HBars rows={sectorRows.map(s => ({
              label: s.sector, right: `${s.conc}/${s.total} · ${s.pct}%`, max: maxSec,
              parts: [{ value: s.conc, color: COLORS.green }, { value: s.atr, color: COLORS.red }],
            }))} />
          )}
        </div>
      </div>
    </div>
  )
}

function initials(name) {
  return (name || '?').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
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

  function Th({ k, label, num }) {
    return (
      <th className={num ? 'num' : ''} onClick={() => toggleSort(k)}>
        {label}{sortKey === k ? (sortAsc ? ' ↑' : ' ↓') : ''}
      </th>
    )
  }

  return (
    <div className="dash-panel">
      <div className="dash-panel-head"><div><div className="dash-section-title">Desempenho por colaborador</div><div className="dash-section-sub">Clique no cabeçalho de uma coluna para ordenar</div></div></div>
      {rows.length === 0 ? (
        <div className="empty">Nenhum colaborador com tarefas no período</div>
      ) : (
        <div className="rep-table-wrap">
          <table className="rep-table">
            <thead>
              <tr>
                <Th k="name"         label="Colaborador" />
                <Th k="total"        label="Total" num />
                <Th k="concluidas"   label="Concluídas" num />
                <Th k="em_andamento" label="Em andamento" num />
                <Th k="atrasadas"    label="Atrasadas" num />
                <Th k="avgMin"       label="Tempo médio" num />
                <Th k="pct"          label="Conclusão" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const col = r.pct >= 80 ? COLORS.green : r.pct >= 50 ? COLORS.orange : COLORS.red
                return (
                  <tr key={r.id}>
                    <td className="strong">{r.name}</td>
                    <td className="num">{r.total}</td>
                    <td className="num">{r.concluidas}</td>
                    <td className="num">{r.em_andamento}</td>
                    <td className="num">{r.atrasadas > 0 ? <span className="rep-pill late">{r.atrasadas}</span> : <span className="muted">0</span>}</td>
                    <td className="num muted">{fmtHours(r.avgMin)}</td>
                    <td className="bar-cell">
                      <div className="bar-line">
                        <div className="hbar-track thin"><i style={{ width: `${r.pct}%`, background: col }} /></div>
                        <span>{r.pct}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
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
    <div className="rep-stack">
      <div className="dash-panel">
        <div className="dash-panel-head"><div><div className="dash-section-title">Desempenho por setor</div><div className="dash-section-sub">Tarefas do período agrupadas por setor</div></div></div>
        {rows.length === 0 ? (
          <div className="empty">Nenhuma tarefa no período</div>
        ) : (
          <div className="rep-table-wrap">
            <table className="rep-table">
              <thead>
                <tr>
                  <th>Setor</th>
                  <th className="num">Total</th>
                  <th className="num">Concluídas</th>
                  <th className="num">Abertas</th>
                  <th>Conclusão</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const pct = r.total ? Math.round((r.concluidas / r.total) * 100) : 0
                  const col = pct >= 80 ? COLORS.green : pct >= 50 ? COLORS.orange : COLORS.red
                  return (
                    <tr key={r.sector}>
                      <td className="strong">{r.sector}</td>
                      <td className="num">{r.total}</td>
                      <td className="num">{r.concluidas}</td>
                      <td className="num">{r.abertas}</td>
                      <td className="bar-cell">
                        <div className="bar-line">
                          <div className="hbar-track thin"><i style={{ width: `${pct}%`, background: col }} /></div>
                          <span>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="dash-panel">
          <div className="dash-panel-head"><div><div className="dash-section-title">Volume de tarefas por setor</div><div className="dash-section-sub">Comparativo entre setores</div></div></div>
          <HBars rows={rows.map(r => ({ label: r.sector, right: r.total, max: maxTotal, parts: [{ value: r.total, color: COLORS.navy }] }))} />
        </div>
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
      title: 'Documentos PDF', fmt: 'PDF', sub: 'Com logo e nome da empresa',
      items: [
        { label: 'Resumo executivo',          desc: 'KPIs gerais, taxa de conclusão e tempo médio',                    fn: exportPDF_Overview  },
        { label: 'Todas as tarefas',          desc: `${tasks.length} tarefas · tabela completa em paisagem`,           fn: exportPDF_Tasks     },
        { label: 'Relatório por colaborador', desc: `${providers.length} colaboradores com métricas de desempenho`,    fn: exportPDF_Providers },
      ]
    },
    {
      title: 'Arquivo XML', fmt: 'XML', sub: 'Para integração com outros sistemas',
      items: [
        { label: 'Tarefas em XML', desc: `${tasks.length} tarefas · estrutura padronizada em UTF-8`, fn: exportXML },
      ]
    },
    {
      title: 'Planilhas CSV', fmt: 'CSV', sub: 'Para Excel e Google Planilhas',
      items: [
        { label: 'Todas as tarefas',          desc: `${tasks.length} tarefas com todos os campos`, fn: dlTasks      },
        { label: 'Tarefas concluídas',        desc: `${tasks.filter(t => t.status === 'concluida').length} tarefas concluídas`, fn: dlDone },
        { label: 'Relatório por colaborador', desc: `${providers.length} colaboradores com métricas`, fn: dlProviders },
      ]
    },
  ]

  return (
    <div className="rep-stack">
      {exportGroups.map(group => (
        <div key={group.title} className="dash-panel">
          <div className="dash-panel-head">
            <div><div className="dash-section-title">{group.title}</div><div className="dash-section-sub">{group.sub}</div></div>
            <span className="rep-fmt">{group.fmt}</span>
          </div>
          <div className="rep-export-list">
            {group.items.map(b => (
              <div key={b.label} className="rep-export-row">
                <div><b>{b.label}</b><span>{b.desc}</span></div>
                <button className="btn-sec with-icon" onClick={b.fn}><Icon name="download" size={15} /> Baixar</button>
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
  { id: 'overview',  label: 'Visão geral' },
  { id: 'providers', label: 'Por colaborador' },
  { id: 'sectors',   label: 'Por setor' },
  { id: 'export',    label: 'Exportar' },
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

const STA_OPTIONS = ['cadastrada','pendente','em_andamento','pausada','prestador_externo','concluida','cancelada']
const STA_LABELS  = { cadastrada:'Cadastrada', pendente:'Pendente', em_andamento:'Em andamento', pausada:'Pausada', prestador_externo:'Prestador Externo', concluida:'Concluída', cancelada:'Cancelada' }
const URG_OPTIONS = ['critica','alta','media','baixa']
const URG_LABELS  = { critica:'Crítica', alta:'Alta', media:'Média', baixa:'Baixa' }


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
        supabase.from('tasks').select('id,title,status,urgency,sector,assignee_id,created_at,due_date,completed_at,sla_deadline,elapsed_minutes,source,recurrence_id').order('created_at', { ascending: false }),
        supabase.from('providers').select('id,name').eq('active', 1).order('name'),
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

      {/* ── Cabeçalho da tela ── */}
      <div className="no-print page-head">
        <div>
          <h2>Relatórios</h2>
          <p>
            {periodLabel[period] || period} · {tasks.length} tarefa{tasks.length !== 1 ? 's' : ''}
            {activeFilters.length > 0 && ` · ${activeFilters.join(' · ')}`}
          </p>
        </div>
        <button className="btn-sec with-icon" onClick={() => window.print()}>
          <Icon name="printer" size={16} /> Imprimir
        </button>
      </div>

      {/* ── Filtros ── */}
      <div className="no-print ctrl-row toolbar" style={{ flexWrap: 'wrap' }}>
        <select value={period} onChange={e => setPeriod(e.target.value)}>
          {PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {period === 'mes' && (
          <select value={monthYear} onChange={e => setMonthYear(e.target.value)}>
            {MONTH_OPTS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
          </select>
        )}
        {period === 'custom' && (<>
          <input type="date" className="finput rep-date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
          <span className="rep-until">até</span>
          <input type="date" className="finput rep-date" value={customTo}   onChange={e => setCustomTo(e.target.value)} />
        </>)}

        <span className="toolbar-sep" />

        <select value={fSector} onChange={e => setFSector(e.target.value)}>
          <option value="">Todos os setores</option>
          {sectors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={fProvider} onChange={e => setFProvider(e.target.value)}>
          <option value="">Todos os colaboradores</option>
          {providers.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
        </select>
        <select value={fStatus} onChange={e => setFStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {STA_OPTIONS.map(s => <option key={s} value={s}>{STA_LABELS[s]}</option>)}
        </select>
        <select value={fUrgency} onChange={e => setFUrgency(e.target.value)}>
          <option value="">Todas as urgências</option>
          {URG_OPTIONS.map(u => <option key={u} value={u}>{URG_LABELS[u]}</option>)}
        </select>

        {hasFilter && (
          <button className="btn-sec with-icon" onClick={clearFilters}>Limpar filtros</button>
        )}
      </div>

      {/* Filtros ativos — visível também na impressão */}
      {activeFilters.length > 0 && (
        <div className="rep-chips print-only">
          <span>Filtros:</span>
          {activeFilters.map(f => <span key={f} className="chip">{f}</span>)}
        </div>
      )}

      {/* ── Abas ── */}
      <div className="stab-bar no-print">
        {TABS.map(t => (
          <button key={t.id} className={`stab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Conteúdo ── */}
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
