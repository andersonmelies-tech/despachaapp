const NAV = [
  { id: 'dashboard', label: 'Início',   icon: '⊞' },
  { id: 'tasks',     label: 'Tarefas',  icon: '✓' },
  { id: 'calendar',  label: 'Agenda',   icon: '⊡' },
  { id: 'settings',  label: 'Configurações', icon: '⚙' },
]

export default function MobileNav({ tab, setTab, stats }) {
  return (
    <nav className="mobile-nav">
      {NAV.map(item => (
        <button
          key={item.id}
          className={`mn-btn${tab === item.id ? ' active' : ''}`}
          onClick={() => setTab(item.id)}
        >
          <span className="mn-icon">{item.icon}</span>
          <span className="mn-label">{item.label}</span>
          {item.id === 'tasks' && stats?.atrasadas > 0 && (
            <span className="mn-badge">{stats.atrasadas}</span>
          )}
        </button>
      ))}
    </nav>
  )
}
