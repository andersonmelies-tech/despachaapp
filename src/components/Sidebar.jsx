export default function Sidebar({ sideFilter, setSideFilter, stats }) {
  const s = stats || {}

  const filters = [
    { id: 'all',          label: 'Todas as tarefas', icon: '≡',  badge: s.total,        cls: '' },
    { id: 'pendente',     label: 'Pendentes',         icon: '⏳', badge: s.pendente,     cls: 'bd-warn' },
    { id: 'em_andamento', label: 'Em andamento',      icon: '▶',  badge: s.em_andamento, cls: 'bd-blue' },
    { id: 'concluida',    label: 'Concluídas',        icon: '✓',  badge: s.concluida,    cls: 'bd-green' },
    { id: 'atrasadas',    label: 'Atrasadas',         icon: '!',  badge: s.atrasadas,    cls: 'bd-red' },
    { id: 'criticas',     label: 'Críticas',          icon: '⚠',  badge: s.criticas,     cls: 'bd-red' },
  ]

  return (
    <aside className="sidebar">

      <div className="sb-header">
        <span className="sb-header-title">Filtros</span>
        {sideFilter !== 'all' && (
          <button className="sb-clear" onClick={() => setSideFilter('all')} title="Limpar filtro">✕</button>
        )}
      </div>

      <div className="sb-filters">
        {filters.map(f => (
          <div
            key={f.id}
            className={`sb-item${sideFilter === f.id ? ' active' : ''}`}
            onClick={() => setSideFilter(f.id)}
          >
            <span className="sb-icon">{f.icon}</span>
            <span className="sb-label-text">{f.label}</span>
            {f.badge != null && (
              <span className={`badge${f.cls ? ' ' + f.cls : ''}`}>{f.badge}</span>
            )}
          </div>
        ))}
      </div>

      {/* Mini stats */}
      {s.atrasadas > 0 && (
        <div className="sb-alert">
          <span className="sb-alert-icon">⚠</span>
          <span>{s.atrasadas} tarefa{s.atrasadas > 1 ? 's' : ''} atrasada{s.atrasadas > 1 ? 's' : ''}</span>
        </div>
      )}

    </aside>
  )
}
