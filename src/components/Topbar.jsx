const TABS = [
  { id: 'dashboard', label: '📊 Dashboard' },
  { id: 'tasks',     label: '📋 Tarefas' },
  { id: 'calendar',  label: '📅 Agenda' },
  { id: 'settings',  label: '⚙️ Config' },
]

export default function Topbar({ tab, setTab, user, onLogout }) {
  return (
    <div className="topbar">
      <div className="brand">
        <div className="brand-icon">🚀</div>
        <div className="brand-name">DESPACHA</div>
        <div className="brand-sep" />
        <div className="brand-sub">Gestão de Serviços</div>
      </div>

      <div className="topbar-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab-btn${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="topbar-right">
        <div className="user-info" onClick={onLogout} title="Clique para sair">
          👤 {user?.username || user?.name || 'usuário'}
          {user?.role && (
            <span className={`role-badge ${user.role}`} style={{ marginLeft: '.3rem' }}>
              {user.role}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
