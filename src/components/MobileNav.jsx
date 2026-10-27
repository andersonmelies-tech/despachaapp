import Icon from './Icons.jsx'

const NAV = [
  { id: 'dashboard', label: 'Início',     icon: 'dashboard' },
  { id: 'tasks',     label: 'Tarefas',    icon: 'tasks'     },
  { id: 'calendar',  label: 'Agenda',     icon: 'calendar'  },
  { id: 'reports',   label: 'Relatórios', icon: 'reports'   },
  { id: 'settings',  label: 'Config.',    icon: 'settings'  },
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
          <span className="mn-icon"><Icon name={item.icon} size={20} /></span>
          <span className="mn-label">{item.label}</span>
          {item.id === 'tasks' && stats?.atrasadas > 0 && (
            <span className="mn-badge">{stats.atrasadas}</span>
          )}
        </button>
      ))}
    </nav>
  )
}
