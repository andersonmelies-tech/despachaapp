const NAV_ITEMS = [
  { id: 'dashboard',   label: 'Dashboard',     icon: '▦'  },
  { id: 'tasks',       label: 'Tarefas',       icon: '≡'  },
  { id: 'recurrences', label: 'Recorrências',  icon: '🔄' },
  { id: 'calendar',    label: 'Agenda',        icon: '📅' },
  { id: 'reports',     label: 'Relatórios',    icon: '📊' },
  { id: 'settings',    label: 'Configurações', icon: '⚙'  },
]

const FILTERS = [
  { id: 'all',          label: 'Todas',        icon: '≡',  statKey: 'total',        cls: '' },
  { id: 'pendente',     label: 'Pendentes',    icon: '⏳', statKey: 'pendente',     cls: 'bd-warn' },
  { id: 'em_andamento', label: 'Em andamento', icon: '▶',  statKey: 'em_andamento', cls: 'bd-blue' },
  { id: 'concluida',    label: 'Concluídas',   icon: '✓',  statKey: 'concluida',    cls: 'bd-green' },
  { id: 'atrasadas',    label: 'Atrasadas',    icon: '!',  statKey: 'atrasadas',    cls: 'bd-red' },
  { id: 'criticas',     label: 'Críticas',     icon: '⚠',  statKey: 'criticas',     cls: 'bd-red' },
]

export default function Sidebar({ tab, setTab, sideFilter, setSideFilter, stats, isSuperAdmin, plan, pendingRequests }) {
  const s = stats || {}
  const isTasksTab = tab === 'tasks'

  return (
    <aside className="sidebar">

      {/* ── Navegação ── */}
      <div className="sb-section">
        <div className="sb-section-label">Navegação</div>
        {NAV_ITEMS.map(item => (
          <div
            key={item.id}
            className={`sb-item${tab === item.id ? ' active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            <span className="sb-icon">{item.icon}</span>
            <span className="sb-label-text">{item.label}</span>
            {item.id === 'tasks' && s.atrasadas > 0 && (
              <span className="badge bd-red">{s.atrasadas}</span>
            )}
          </div>
        ))}
      </div>

      {/* ── Solicitações Públicas ── */}
      <div className="sb-section">
        <div className="sb-section-label">Solicitações</div>
        <div
          className={`sb-item${tab === 'requests' ? ' active' : ''}`}
          onClick={() => setTab('requests')}
        >
          <span className="sb-icon">📥</span>
          <span className="sb-label-text">Fila de Pedidos</span>
          {pendingRequests > 0 && (
            <span className="badge bd-red">{pendingRequests}</span>
          )}
        </div>
      </div>

      {/* ── Enterprise ── */}
      {(plan === 'enterprise' || isSuperAdmin) && (
        <div className="sb-section">
          <div className="sb-section-label">Enterprise</div>
          {[
            { id: 'clients',      icon: '👥', label: 'Clientes' },
            { id: 'budgets',      icon: '💰', label: 'Orçamentos' },
            { id: 'serviceorders',icon: '📋', label: 'Ordens de Serviço' },
            { id: 'payments',     icon: '💸', label: 'Pag. Terceiros' },
            { id: 'cashflow',     icon: '💳', label: 'Caixa' },
          ].map(item => (
            <div key={item.id} className={`sb-item${tab === item.id ? ' active' : ''}`} onClick={() => setTab(item.id)}>
              <span className="sb-icon">{item.icon}</span>
              <span className="sb-label-text">{item.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Admin (superadmin only) ── */}
      {isSuperAdmin && (
        <div className="sb-section">
          <div className="sb-section-label">Sistema</div>
          <div
            className={`sb-item sb-admin${tab === 'admin' ? ' active' : ''}`}
            onClick={() => setTab('admin')}
          >
            <span className="sb-icon">🛡️</span>
            <span className="sb-label-text">Admin</span>
            <span className="badge" style={{ background: '#9b59f522', color: 'var(--purple)', border: '1px solid #9b59f544' }}>SYS</span>
          </div>
        </div>
      )}

      {/* ── Filtros (só na aba Tarefas) ── */}
      {isTasksTab && (
        <div className="sb-section">
          <div className="sb-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Filtros</span>
            {sideFilter !== 'all' && (
              <button className="sb-clear" onClick={() => setSideFilter('all')}>✕ limpar</button>
            )}
          </div>
          {FILTERS.map(f => (
            <div
              key={f.id}
              className={`sb-item sb-filter${sideFilter === f.id ? ' active' : ''}`}
              onClick={() => setSideFilter(f.id)}
            >
              <span className="sb-icon">{f.icon}</span>
              <span className="sb-label-text">{f.label}</span>
              {s[f.statKey] != null && (
                <span className={`badge${f.cls ? ' ' + f.cls : ''}`}>{s[f.statKey]}</span>
              )}
            </div>
          ))}
        </div>
      )}

    </aside>
  )
}
