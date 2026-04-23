import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

const PLANS = [
  {
    id:       'starter',
    name:     'Starter',
    price:    'R$ 97',
    period:   '/mês',
    color:    'var(--blue)',
    badge:    null,
    features: [
      '✅ Até 3 usuários',
      '✅ Até 5 prestadores',
      '✅ Tarefas ilimitadas',
      '✅ Bot Telegram',
      '✅ Calendário e Dashboard',
      '❌ API / Integrações ERP',
      '❌ Relatórios avançados',
      '❌ Suporte prioritário',
    ],
  },
  {
    id:       'pro',
    name:     'Pro',
    price:    'R$ 197',
    period:   '/mês',
    color:    'var(--orange)',
    badge:    '⭐ Mais popular',
    features: [
      '✅ Usuários ilimitados',
      '✅ Prestadores ilimitados',
      '✅ Tarefas ilimitadas',
      '✅ Bot Telegram',
      '✅ API REST para ERP',
      '✅ Relatórios + Exportação CSV',
      '✅ Suporte via WhatsApp',
      '❌ White-label',
    ],
  },
  {
    id:       'enterprise',
    name:     'Enterprise',
    price:    'R$ 497',
    period:   '/mês',
    color:    'var(--purple)',
    badge:    '🏢 Para grandes equipes',
    features: [
      '✅ Tudo do Pro',
      '✅ White-label (sua logo)',
      '✅ Domínio personalizado',
      '✅ SLA customizado',
      '✅ Relatório PDF automático',
      '✅ Onboarding dedicado',
      '✅ Suporte prioritário 24/7',
      '✅ Contrato personalizado',
    ],
  },
]

export default function Pricing({ session, trialDaysLeft, onSuccess }) {
  const [loading, setLoading] = useState(null)
  const [error,   setError]   = useState('')

  async function subscribe(planId) {
    setLoading(planId); setError('')
    try {
      const token = session?.access_token
      const res = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ plan: planId }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        setError(data.error || 'Erro ao iniciar pagamento')
      }
    } catch (e) {
      setError('Erro de conexão. Tente novamente.')
    }
    setLoading(null)
  }

  return (
    <div className="pricing-overlay">
      <div className="pricing-inner">

        {/* Header */}
        <div className="pricing-header">
          <img src="/icon.png" alt="" className="pricing-icon" />
          <h1 className="pricing-title">
            {trialDaysLeft > 0
              ? <>Seu trial termina em <span>{trialDaysLeft} dia{trialDaysLeft !== 1 ? 's' : ''}</span></>
              : <>Seu período de teste encerrou</>}
          </h1>
          <p className="pricing-sub">
            Escolha um plano para continuar usando o DespachaApp sem interrupções.
          </p>
          {trialDaysLeft > 0 && (
            <div className="trial-progress-bar">
              <div className="trial-progress-fill" style={{ width: `${Math.min(100, ((14 - trialDaysLeft) / 14) * 100)}%` }} />
            </div>
          )}
        </div>

        {/* Cards */}
        <div className="pricing-grid">
          {PLANS.map(plan => (
            <div key={plan.id} className={`plan-card${plan.badge ? ' plan-featured' : ''}`}
                 style={{ '--plan-color': plan.color }}>
              {plan.badge && <div className="plan-badge">{plan.badge}</div>}
              <div className="plan-name">{plan.name}</div>
              <div className="plan-price">
                {plan.price}<span className="plan-period">{plan.period}</span>
              </div>
              <ul className="plan-features">
                {plan.features.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
              <button
                className={`plan-btn${plan.badge ? ' plan-btn-featured' : ''}`}
                onClick={() => subscribe(plan.id)}
                disabled={loading === plan.id}
                style={plan.badge ? { background: plan.color } : {}}
              >
                {loading === plan.id ? '⏳ Redirecionando…' : 'Assinar agora →'}
              </button>
            </div>
          ))}
        </div>

        {error && <div className="pricing-error">⚠ {error}</div>}

        <div className="pricing-footer">
          🔒 Pagamento seguro via Stripe &nbsp;·&nbsp; Cancele quando quiser &nbsp;·&nbsp;
          Sem taxa de cancelamento
        </div>
      </div>
    </div>
  )
}
