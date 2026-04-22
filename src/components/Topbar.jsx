const TABS = [
  { id: 'dashboard', label: 'Dashboard',  icon: '▦' },
  { id: 'tasks',     label: 'Tarefas',    icon: '≡' },
  { id: 'calendar',  label: 'Agenda',     icon: '⊞' },
  { id: 'settings',  label: 'Config',     icon: '⚙' },
]

const ROLE_LABEL = { admin: 'Admin', manager: 'Gerente', operator: 'Operador', viewer: 'Visualizador' }

export default function Topbar({ tab, setTab, user, onLogout }) {
  return (
    <div className="topbar">

      {/* Brand */}
      <div className="brand">
        <img src="/icon.png" alt="" className="brand-icon-img" />
        <span className="brand-name">DESPAСHA<em>APP</em></span>
      </div>

      {/* Tabs */}
      <nav className="topbar-nav">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab-btn${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {/* User */}
      <div className="topbar-right">
        <div className="user-pill">
          <span className="user-avatar">{(user?.name || user?.username || 'U')[0].toUpperCase()}</span>
          <div className="user-info-block">
            <span className="user-name">{user?.name || user?.username || 'usuário'}</span>
            {user?.role && <span className={`role-badge ${user.role}`}>{ROLE_LABEL[user.role] || user.role}</span>}
          </div>
        </div>
        <button className="logout-btn" onClick={onLogout} title="Sair">
          ⏻
        </button>
      </div>

    </div>
  )
}
