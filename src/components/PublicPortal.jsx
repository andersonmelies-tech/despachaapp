/**
 * Portal público unificado — /portal?c=INVITE_CODE
 * Página de entrada com as duas opções: Solicitar ou Acompanhar
 */
import { useState, useEffect } from 'react'

function useBranding(inviteCode) {
  const [b, setB] = useState({ logo_url: null, primary_color: '#2563eb', company_name: null, loaded: false })
  useEffect(() => {
    fetch(`/api/public/branding?c=${inviteCode}`)
      .then(r => r.json())
      .then(d => setB({ ...d, loaded: true }))
      .catch(() => setB(p => ({ ...p, loaded: true })))
  }, [inviteCode])
  return b
}

export default function PublicPortal() {
  const params     = new URLSearchParams(window.location.search)
  const inviteCode = params.get('c') || ''
  const brand      = useBranding(inviteCode)

  const solicitar    = `/solicitar${inviteCode ? '?c=' + inviteCode : ''}`
  const acompanhar   = `/acompanhar${inviteCode ? '?c=' + inviteCode : ''}`
  const color        = brand.primary_color || '#2563eb'
  const colorDark    = '#1e3a5f'

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(135deg, ${colorDark} 0%, ${color} 100%)`,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '2rem 1rem',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>

      {/* Logo da empresa */}
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        {brand.logo_url ? (
          <img
            src={brand.logo_url}
            alt={brand.company_name || 'Logo'}
            style={{ maxHeight: 90, maxWidth: 280, objectFit: 'contain',
              filter: 'drop-shadow(0 3px 12px rgba(0,0,0,.4))' }}
          />
        ) : (
          brand.company_name && (
            <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#fff',
              letterSpacing: '.04em', textShadow: '0 2px 10px rgba(0,0,0,.3)' }}>
              {brand.company_name}
            </div>
          )
        )}
      </div>

      {/* Card principal */}
      <div style={{
        background: '#fff', borderRadius: 20, width: '100%', maxWidth: 420,
        boxShadow: '0 24px 64px rgba(0,0,0,.28)', overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          background: `linear-gradient(135deg, ${colorDark}, ${color})`,
          padding: '1.5rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '.4rem' }}>🛠️</div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, color: '#fff', letterSpacing: '.02em' }}>
            Central de Serviços
          </h1>
          <p style={{ margin: '.3rem 0 0', fontSize: '.82rem', color: 'rgba(255,255,255,.8)' }}>
            O que você deseja fazer?
          </p>
        </div>

        {/* Opções */}
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Solicitar */}
          <a href={solicitar} style={{ textDecoration: 'none' }}>
            <div style={{
              border: `2px solid ${color}22`, borderRadius: 14, padding: '1.25rem',
              display: 'flex', alignItems: 'center', gap: '1rem',
              background: `${color}08`, cursor: 'pointer',
              transition: 'all .2s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = `${color}15`}
              onMouseLeave={e => e.currentTarget.style.background = `${color}08`}
            >
              <div style={{
                width: 52, height: 52, borderRadius: 14, flexShrink: 0,
                background: `linear-gradient(135deg, ${colorDark}, ${color})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.5rem',
              }}>📤</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: '#1a1a2e', marginBottom: '.2rem' }}>
                  Abrir Solicitação
                </div>
                <div style={{ fontSize: '.8rem', color: '#6b7280', lineHeight: 1.4 }}>
                  Registre um chamado de manutenção ou serviço
                </div>
              </div>
              <div style={{ marginLeft: 'auto', fontSize: '1.2rem', color: color }}>›</div>
            </div>
          </a>

          {/* Acompanhar */}
          <a href={acompanhar} style={{ textDecoration: 'none' }}>
            <div style={{
              border: '2px solid #10b98122', borderRadius: 14, padding: '1.25rem',
              display: 'flex', alignItems: 'center', gap: '1rem',
              background: '#10b98108', cursor: 'pointer',
              transition: 'all .2s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = '#10b98115'}
              onMouseLeave={e => e.currentTarget.style.background = '#10b98108'}
            >
              <div style={{
                width: 52, height: 52, borderRadius: 14, flexShrink: 0,
                background: 'linear-gradient(135deg, #064e3b, #10b981)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.5rem',
              }}>🔍</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: '#1a1a2e', marginBottom: '.2rem' }}>
                  Acompanhar Solicitação
                </div>
                <div style={{ fontSize: '.8rem', color: '#6b7280', lineHeight: 1.4 }}>
                  Consulte o status pelo número do protocolo
                </div>
              </div>
              <div style={{ marginLeft: 'auto', fontSize: '1.2rem', color: '#10b981' }}>›</div>
            </div>
          </a>

        </div>

        {/* Footer */}
        <div style={{
          borderTop: '1px solid #f3f4f6', padding: '.85rem',
          textAlign: 'center', fontSize: '.72rem', color: '#9ca3af',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.5rem',
        }}>
          <img src="/logo.png" alt="DespachaApp"
            style={{ height: 18, width: 'auto', objectFit: 'contain', opacity: .55 }}
            onError={e => { e.target.style.display = 'none' }}
          />
          <span>Powered by <strong style={{ color: '#6b7280' }}>DespachaApp</strong></span>
        </div>
      </div>
    </div>
  )
}
