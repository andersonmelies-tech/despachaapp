import { useState, useEffect, useMemo } from 'react'
import { supabase, isOverdue } from '../lib/supabase.js'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ── Helpers ────────────────────────────────────────────────────────────────────

function getPeriodStart(period, customFrom) {
  const now = new Date()
  if (period === 'hoje') {
    const d = new Date(now); d.setHours(0,0,0,0); return d
  }
  if (period === '7d')  { const d = new Date(now); d.setDate(d.getDate() - 7);  return d }
  if (period === '30d') { const d = new Date(now); d.setDate(d.getDate() - 30); return d }
  if (period === '90d') { const d = new Date(now); d.setDate(d.getDate() - 90); return d }
  if (period === 'custom' && customFrom) return new Date(customFrom)
  return null
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
    'Prestador': t.assignee || '',
    'Setor': t.sector || '',
    'Urgência': t.urgency || '',
    'Status': t.status || '',
    'Prazo': fmt(t.due_date),
    'Criado em': fmt(t.created_at),
    'Concluído em': fmt(t.completed_at),
    'Tempo (min)': t.elapsed_minutes ?? '',
  }
}

// ── Tab 1 — Visão Geral ────────────────────────────────────────────────────────

const BAR_COLORS = {
  pendente:     '#F57E22',
  em_andamento: '#3296EE',
  concluida:    '#00d48a',
  cancelada:    '#7B818F',
  critica:      '#ff4d6d',
  alta:         '#F57E22',
  media:        '#3296EE',
  baixa:        '#00d48a',
}

function OverviewTab({ tasks }) {
  const total      = tasks.length
  const concluidas = tasks.filter(t => t.status === 'concluida').length
  const atrasadas  = tasks.filter(t => isOverdue(t)).length

  const finished   = tasks.filter(t => t.elapsed_minutes)
  const avgMin     = finished.length
    ? Math.round(finished.reduce((a,t) => a + t.elapsed_minutes, 0) / finished.length)
    : 0

  const withSla    = tasks.filter(t => t.sla_deadline && ['concluida','cancelada'].includes(t.status))
  const slaOk      = withSla.filter(t => {
    if (!t.completed_at || !t.sla_deadline) return false
    return new Date(t.completed_at) <= new Date(t.sla_deadline)
  }).length
  const slaPct     = withSla.length ? Math.round((slaOk / withSla.length) * 100) : 0
  const conclusaoPct = total ? Math.round((concluidas / total) * 100) : 0

  const statusCounts = {
    pendente:     tasks.filter(t => t.status === 'pendente').length,
    em_andamento: tasks.filter(t => t.status === 'em_andamento').length,
    concluida:    concluidas,
    cancelada:    tasks.filter(t => t.status === 'cancelada').length,
  }
  const urgCounts = {
    critica: tasks.filter(t => t.urgency === 'critica').length,
    alta:    tasks.filter(t => t.urgency === 'alta').length,
    media:   tasks.filter(t => t.urgency === 'media').length,
    baixa:   tasks.filter(t => t.urgency === 'baixa').length,
  }

  const maxStatus = Math.max(...Object.values(statusCounts), 1)
  const maxUrg    = Math.max(...Object.values(urgCounts), 1)

  const kpis = [
    { label: 'Total de Tarefas',   val: total,               suf: '' },
    { label: 'Taxa de Conclusão',  val: conclusaoPct,        suf: '%' },
    { label: 'Tempo Médio',        val: fmtHours(avgMin),    suf: '', mono: true },
    { label: 'Tarefas Atrasadas',  val: atrasadas,           suf: '', red: true },
    { label: 'SLA Cumprido',       val: slaPct,              suf: '%', green: true },
  ]

  return (
    <div>
      {/* KPI grid */}
      <div className="kpi-grid">
        {kpis.map(k => (
          <div key={k.label} className="kpi-card">
            <div className="kpi-val" style={k.red ? { color: 'var(--red)' } : k.green ? { color: 'var(--green)' } : {}}>
              {k.val}{k.suf}
            </div>
            <div className="kpi-label">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Status bars */}
      <div className="cfg-card" style={{ marginBottom: '1rem' }}>
        <div className="cfg-title">Por Status</div>
        {Object.entries(statusCounts).map(([key, count]) => (
          <div key={key} className="bar-row">
            <span className="bar-label">
              <span className={`stbadge ${key}`}>{key.replace('_',' ')}</span>
            </span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(count/maxStatus)*100}%`, background: BAR_COLORS[key] }} />
            </div>
            <span className="bar-count">{count}</span>
          </div>
        ))}
      </div>

      {/* Urgência bars */}
      <div className="cfg-card">
        <div className="cfg-title">Por Urgência</div>
        {Object.entries(urgCounts).map(([key, count]) => (
          <div key={key} className="bar-row">
            <span className="bar-label">
              <span className={`ubadge ${key}`}>{key}</span>
            </span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(count/maxUrg)*100}%`, background: BAR_COLORS[key] }} />
            </div>
            <span className="bar-count">{count}</span>
          </div>
        ))}
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
      <div className="cfg-title">Por Prestador</div>
      {rows.length === 0 ? (
        <div className="empty">Nenhum prestador com tarefas no período</div>
      ) : (
        <table className="rep-table">
          <thead>
            <tr>
              <Th k="name"        label="Nome" />
              <Th k="total"       label="Total" />
              <Th k="concluidas"  label="Concluídas" />
              <Th k="em_andamento" label="Em andamento" />
              <Th k="atrasadas"   label="Atrasadas" />
              <Th k="avgMin"      label="Tempo médio" />
              <Th k="pct"         label="% Conclusão" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}>{r.name}</td>
                <td style={{ fontFamily: 'var(--mono)' }}>{r.total}</td>
                <td style={{ color: 'var(--green)', fontFamily: 'var(--mono)' }}>{r.concluidas}</td>
                <td style={{ color: 'var(--blue)',  fontFamily: 'var(--mono)' }}>{r.em_andamento}</td>
                <td style={{ color: r.atrasadas > 0 ? 'var(--red)' : 'var(--muted)', fontFamily: 'var(--mono)' }}>{r.atrasadas}</td>
                <td style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{fmtHours(r.avgMin)}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    <div className="prog-bar">
                      <div className="prog-fill" style={{ width: `${r.pct}%` }} />
                    </div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', minWidth: '32px' }}>{r.pct}%</span>
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
      <div className="cfg-title">Por Setor</div>
      {rows.length === 0 ? (
        <div className="empty">Nenhuma tarefa no período</div>
      ) : (
        <>
          <table className="rep-table" style={{ marginBottom: '1.25rem' }}>
            <thead>
              <tr>
                <th>Setor</th>
                <th>Total</th>
                <th>Concluídas</th>
                <th>Abertas</th>
                <th>% Conclusão</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const pct = r.total ? Math.round((r.concluidas / r.total) * 100) : 0
                return (
                  <tr key={r.sector}>
                    <td style={{ fontWeight: 600 }}>{r.sector}</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{r.total}</td>
                    <td style={{ color: 'var(--green)', fontFamily: 'var(--mono)' }}>{r.concluidas}</td>
                    <td style={{ color: 'var(--warn)',  fontFamily: 'var(--mono)' }}>{r.abertas}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        <div className="prog-bar">
                          <div className="prog-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', minWidth: '32px' }}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Barras horizontais */}
          <div className="cfg-title" style={{ marginTop: '.5rem' }}>Volume por setor</div>
          {rows.map(r => (
            <div key={r.sector} className="bar-row">
              <span className="bar-label" style={{ minWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sector}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(r.total/maxTotal)*100}%`, background: 'var(--blue)' }} />
              </div>
              <span className="bar-count">{r.total}</span>
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
      head: [['#', 'Título', 'Prestador', 'Setor', 'Urgência', 'Status', 'Prazo', 'Criado', 'Concluído']],
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
    const startY = await buildPDFHeader(doc, 'Relatório por Prestador', periodLabel[period] || period)

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
      head: [['Prestador','Setor','Total','Concluídas','Andamento','Atrasadas','Tempo Médio','% Conclusão']],
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
    doc.save(`relatorio_prestadores_${new Date().toISOString().slice(0,10)}.pdf`)
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
        'Prestador': p.name, 'Setor': p.sector || '',
        'Total': pt.length, 'Concluídas': concluidas,
        'Em andamento': pt.filter(t => t.status==='em_andamento').length,
        'Atrasadas': pt.filter(t => isOverdue(t)).length,
        'Tempo médio (min)': avgMin ?? '',
        '% Conclusão': pt.length ? Math.round((concluidas/pt.length)*100) : 0,
      }
    })
    exportCSV(rows, 'relatorio_prestadores.csv')
  }

  const exportGroups = [
    {
      title: '📄 PDF — Com logo e nome da empresa',
      color: '#F43F5E',
      items: [
        { label: 'Resumo Executivo',       desc: 'KPIs gerais, taxa de conclusão, tempo médio',              fn: exportPDF_Overview  },
        { label: 'Todas as Tarefas',       desc: `${tasks.length} tarefas · tabela completa (landscape)`,   fn: exportPDF_Tasks     },
        { label: 'Relatório por Prestador',desc: `${providers.length} prestadores com métricas de desempenho`, fn: exportPDF_Providers },
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
        { label: 'Relatório por prestador',   desc: `${providers.length} prestadores com métricas`, fn: dlProviders  },
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
  { id: 'providers', label: '👤 Por Prestador' },
  { id: 'sectors',   label: '🏢 Por Setor' },
  { id: 'export',    label: '📤 Exportar' },
]

const PERIODS = [
  { id: 'hoje',   label: 'Hoje' },
  { id: '7d',     label: '7 dias' },
  { id: '30d',    label: '30 dias' },
  { id: '90d',    label: '90 dias' },
  { id: 'custom', label: 'Personalizado' },
]

export default function Reports({ showToast }) {
  const [tab,        setTab]        = useState('overview')
  const [period,     setPeriod]     = useState('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')
  const [allTasks,   setAllTasks]   = useState([])
  const [providers,  setProviders]  = useState([])
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [tr, pr] = await Promise.all([
        supabase.from('tasks').select('*').order('created_at', { ascending: false }),
        supabase.from('providers').select('*').eq('active', 1).order('name'),
      ])
      setAllTasks(tr.data || [])
      setProviders(pr.data || [])
      setLoading(false)
    }
    load()
  }, [])

  const tasks = useMemo(() => {
    const start = getPeriodStart(period, customFrom)
    const end   = period === 'custom' && customTo ? new Date(customTo + 'T23:59:59') : null

    return allTasks.filter(t => {
      const d = new Date(t.created_at)
      if (start && d < start) return false
      if (end   && d > end)   return false
      return true
    })
  }, [allTasks, period, customFrom, customTo])

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '.65rem' }}>
        <h2 style={{ fontFamily: 'var(--mono)', fontSize: '1rem', color: 'var(--blue)', letterSpacing: '.04em' }}>
          📊 RELATÓRIOS
        </h2>

        {/* Filtro de período */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <select
            className="finput"
            style={{ width: 'auto', padding: '.4rem .65rem', fontSize: '.82rem' }}
            value={period}
            onChange={e => setPeriod(e.target.value)}
          >
            {PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {period === 'custom' && (
            <>
              <input
                type="date"
                className="finput"
                style={{ width: 'auto', padding: '.4rem .65rem', fontSize: '.82rem' }}
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
              />
              <span style={{ color: 'var(--muted)', fontSize: '.82rem' }}>até</span>
              <input
                type="date"
                className="finput"
                style={{ width: 'auto', padding: '.4rem .65rem', fontSize: '.82rem' }}
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
              />
            </>
          )}
          <span style={{ fontSize: '.78rem', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            {tasks.length} tarefa{tasks.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="stab-bar" style={{ marginBottom: '1.25rem' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`stab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="empty">Carregando dados…</div>
      ) : (
        <>
          {tab === 'overview'  && <OverviewTab  tasks={tasks} />}
          {tab === 'providers' && <ProviderTab  tasks={tasks} providers={providers} />}
          {tab === 'sectors'   && <SectorTab    tasks={tasks} />}
          {tab === 'export'    && <ExportTab    tasks={tasks} providers={providers} period={period} />}
        </>
      )}
    </div>
  )
}
