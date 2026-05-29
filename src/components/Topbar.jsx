import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const ROLE_LABEL = { admin: 'Admin', manager: 'Gerente', operator: 'Operador', viewer: 'Visualizador' }

export default function Topbar({ user, onLogout }) {
  const [rtStatus, setRtStatus] = useState('connecting') // connecting | connected | disconnected

  useEffect(() => {
    // Canal de presença para monitorar status da conexão realtime
    const ch = supabase.channel('rt-presence')
      .subscribe(status => {
        if (status === 'SUBSCRIBED')   setRtStatus('connected')
        if (status === 'CLOSED')       setRtStatus('disconnected')
        if (status === 'CHANNEL_ERROR') setRtStatus('disconnected')
      })
    return () => supabase.removeChannel(ch)
  }, [])

  return (
    <div className="topbar">
      <div className="brand">
        <img src="/icon.png" alt="" className="brand-icon-img" />
        <span className="brand-name">DESPACHA<em>APP</em></span>
        <span className="brand-sub">Gestão de Serviços</span>
      </div>

      <div className="topbar-right">
        {/* Indicador de conexão ao vivo */}
        <div title={rtStatus === 'connected' ? 'Painel ao vivo' : 'Reconectando…'}
          style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.72rem',
            color: rtStatus === 'connected' ? 'var(--green)' : 'var(--warn)',
            fontFamily: 'var(--mono)', letterSpacing: '.04em', padding: '0 .5rem' }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: rtStatus === 'connected' ? 'var(--green)' : 'var(--warn)',
            animation: rtStatus === 'connected' ? 'rtpulse 2.4s ease-in-out infinite' : 'none',
          }} />
          {rtStatus === 'connected' ? 'AO VIVO' : 'CONECTANDO'}
        </div>
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
