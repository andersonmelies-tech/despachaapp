// Gráficos SVG leves (sem dependências) usados no Dashboard
export const COLORS = {
  blue: '#2563eb', navy: '#1B4F8A', orange: '#f57c14', green: '#16a34a',
  red: '#dc2626', warn: '#d97706', purple: '#7c3aed', gray: '#94a3b8', grid: '#e2e8f0',
}

export function TrendChart({ data = [] }) {
  const W = 640, H = 230, L = 30, B = 26, T = 12, R = 10
  const max = Math.max(3, ...data.map(d => Math.max(d.criadas, d.concluidas)))
  const nice = Math.ceil(max / 3) * 3
  const x = i => L + i * (W - L - R) / Math.max(1, data.length - 1)
  const y = v => T + (H - T - B) * (1 - v / nice)
  const line = k => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ')
  const area = k => `${line(k)} L${x(data.length - 1)},${H - B} L${x(0)},${H - B} Z`
  const ticks = [0, 1, 2, 3].map(i => nice / 3 * i)
  const empty = data.every(d => !d.criadas && !d.concluidas)

  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tarefas criadas e concluídas nos últimos 14 dias">
      <defs>
        <linearGradient id="gCri" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={COLORS.orange} stopOpacity=".28"/><stop offset="1" stopColor={COLORS.orange} stopOpacity="0"/></linearGradient>
        <linearGradient id="gCon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={COLORS.green} stopOpacity=".24"/><stop offset="1" stopColor={COLORS.green} stopOpacity="0"/></linearGradient>
      </defs>
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={COLORS.grid} strokeDasharray="3 4" />
          <text x={L - 7} y={y(v) + 3} textAnchor="end">{Math.round(v)}</text>
        </g>
      ))}
      {!empty && <>
        <path d={area('criadas')} fill="url(#gCri)" />
        <path d={area('concluidas')} fill="url(#gCon)" />
        <path d={line('criadas')} fill="none" stroke={COLORS.orange} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
        <path d={line('concluidas')} fill="none" stroke={COLORS.green} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
        {['criadas', 'concluidas'].map(k => data.map((d, i) => d[k] > 0 && (
          <circle key={k + i} cx={x(i)} cy={y(d[k])} r="3.4" fill="#fff" stroke={k === 'criadas' ? COLORS.orange : COLORS.green} strokeWidth="2">
            <title>{`${d.dia.slice(8)}/${d.dia.slice(5, 7)} — ${k}: ${d[k]}`}</title>
          </circle>
        )))}
      </>}
      {empty && <text x={W / 2} y={H / 2} textAnchor="middle" style={{ fontSize: 12 }}>Sem movimentação nos últimos 14 dias</text>}
      {data.map((d, i) => (i % 2 === 0 || i === data.length - 1) && (
        <text key={d.dia} x={x(i)} y={H - 7} textAnchor="middle">{d.dia.slice(8)}/{d.dia.slice(5, 7)}</text>
      ))}
    </svg>
  )
}

export function Donut({ segments, centerValue, centerLabel }) {
  const total = segments.reduce((a, s) => a + s.value, 0)
  const R = 62, CIRC = 2 * Math.PI * R
  let off = 0
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 170 170" role="img" aria-label="Distribuição por status">
        <circle cx="85" cy="85" r={R} fill="none" stroke="#eef2f7" strokeWidth="16" />
        {total > 0 && segments.filter(s => s.value > 0).map(s => {
          const len = s.value / total * CIRC
          const el = (
            <circle key={s.label} cx="85" cy="85" r={R} fill="none" stroke={s.color} strokeWidth="16"
              strokeDasharray={`${Math.max(len - 3, .5)} ${CIRC}`} strokeDashoffset={-off} transform="rotate(-90 85 85)" />
          )
          off += len
          return el
        })}
        <text x="85" y="87" textAnchor="middle" className="donut-val">{centerValue}</text>
        <text x="85" y="106" textAnchor="middle" className="donut-sub">{centerLabel}</text>
      </svg>
      <div className="donut-legend">
        {segments.map(s => (
          <div key={s.label} className="donut-legend-row">
            <i style={{ background: s.color }} />{s.label}<b>{s.value}</b>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Gauge({ value }) {
  const R = 70, ARC = Math.PI * R
  const f = value == null ? 0 : value / 100
  const col = value == null ? COLORS.gray : value >= 85 ? COLORS.green : value >= 60 ? COLORS.warn : COLORS.red
  const msg = value == null ? 'Ainda sem tarefas concluídas com SLA para medir.'
    : value >= 85 ? 'Operação dentro da meta de prazo.'
    : value >= 60 ? 'Atenção: parte das entregas está estourando o SLA.'
    : 'Crítico: maioria das entregas fora do SLA.'
  return (
    <div className="gauge-wrap">
      <svg viewBox="0 0 180 112" role="img" aria-label={`SLA cumprido: ${value ?? 'sem dados'}%`}>
        <path d="M20,95 A70,70 0 0 1 160,95" fill="none" stroke="#eef2f7" strokeWidth="14" strokeLinecap="round" />
        {value != null && <path d="M20,95 A70,70 0 0 1 160,95" fill="none" stroke={col} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${ARC * f} ${ARC}`} />}
        <text x="90" y="88" textAnchor="middle" className="donut-val" style={{ fontSize: 28 }}>{value == null ? '–' : `${value}%`}</text>
      </svg>
      <div className="gauge-note">{msg}</div>
    </div>
  )
}

// rows: [{ label, right, max, parts: [{ value, color }] }]
export function HBars({ rows }) {
  return rows.map(r => (
    <div key={r.label} className="hbar">
      <div className="hbar-top"><span>{r.label}</span><span>{r.right}</span></div>
      <div className="hbar-track">
        {r.parts.map((p, i) => <i key={i} style={{ width: `${p.value / (r.max || 1) * 100}%`, background: p.color }} />)}
      </div>
    </div>
  ))
}
