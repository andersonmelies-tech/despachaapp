export default function Sidebar({ tab, setTab, sideFilter, setSideFilter, stats }) {
  const s = stats || {}

  const filters = [
    { id: 'all',         label: 'Todas',         ic: '📋', badge: s.total,        cls: '' },
    { id: 'pendente',    label: 'Pendentes',      ic: '⏳', badge: s.pendente,     cls: 'bd-warn' },
    { id: 'em_andamento',label: 'Em andamento',   ic: '🔧', badge: s.em_andamento, cls: 'bd-blue' },
    { id: 'concluida',   label: 'Concluídas',     ic: '✅', badge: s.concluida,    cls: 'bd-green' },
    { id: 'atrasadas',   label: 'Atrasadas',      ic: '⏰', badge: s.atrasadas,    cls: 'bd-red' },
    { id: 'criticas',    label: 'Críticas',       ic: '🚨', badge: s.criticas,     cls: 'bd-red' },
  ]

  return (
    <div className="sidebar">
      <div className="sb-section">
        <div className="sb-label">Navegação</div>
        {[
          { id: 'dashboard', label: 'Dashboard',  ic: '📊' },
          { id: 'tasks',     label: 'Tarefas',    ic: '📋' },
          { id: 'calendar',  label: 'Agenda',     ic: '📅' },
          { id: 'settings',  label: 'Config',     ic: '⚙️' },
        ].map(item => (
          <div
            key={item.id}
            className={`sb-item${tab === item.id ? ' active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            <span><span className="ic">{item.ic}</span> {item.label}</span>
          </div>
        ))}
      </div>

      <div className="sb-section">
        <div className="sb-label">Filtros</div>
        {filters.map(f => (
          <div
            key={f.id}
            className={`sb-item${sideFilter === f.id && tab === 'tasks' ? ' active' : ''}`}
            onClick={() => setSideFilter(f.id)}
          >
            <span><span className="ic">{f.ic}</span> {f.label}</span>
            {f.badge != null && (
              <span className={`badge${f.cls ? ' ' + f.cls : ''}`}>{f.badge}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
