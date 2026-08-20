const ROLE_LABEL = { admin: 'Admin', manager: 'Gerente', operator: 'Operador', viewer: 'Visualizador' }

export default function Topbar({ user, onLogout }) {
  return (
    <div className="topbar">
      <div className="brand">
        <img src="/icon.png" alt="" className="brand-icon-img" />
        <span className="brand-name">DESPACHA<em>APP</em></span>
        <span className="brand-sub">Gestão de Serviços</span>
      </div>

      <div className="topbar-right">
        <div className="user-pill">
          <span className="user-avatar">
            {(user?.name || user?.username || 'U')[0].toUpperCase()}
          </span>
          <div className="user-info-block">
            <span className="user-name">{user?.name || user?.username || 'usuário'}</span>
            {user?.role && (
              <span className={`role-badge ${user.role}`}>
                {ROLE_LABEL[user.role] || user.role}
              </span>
            )}
          </div>
        </div>
        <button className="logout-btn" onClick={onLogout} title="Sair">
          ⏻ Sair
        </button>
      </div>
    </div>
  )
}
