import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

// ── IDs dos preços no Stripe ────────────────────────────────────────────────
// Mensal
const PRICES_MONTHLY = {
  starter:    'price_1TPRCsGsVnzNJmCnvEK08gWJ',
  pro:        'price_1TPRCuGsVnzNJmCnpHGEdWqL',
  enterprise: 'price_1TPRCvGsVnzNJmCncqhh6auF',
}
// Anual — criar no Stripe Dashboard e substituir abaixo
const PRICES_ANNUAL = {
  starter:    import.meta.env.VITE_STRIPE_PRICE_STARTER_ANNUAL    || 'price_annual_starter_placeholder',
  pro:        import.meta.env.VITE_STRIPE_PRICE_PRO_ANNUAL        || 'price_annual_pro_placeholder',
  enterprise: import.meta.env.VITE_STRIPE_PRICE_ENTERPRISE_ANNUAL || 'price_annual_enterprise_placeholder',
}

// ── Planos ──────────────────────────────────────────────────────────────────
const PLANS = [
  {
    id:    'starter',
    name:  'Starter',
    color: 'var(--blue)',
    badge: null,
    monthly:     { price: 97,  display: 'R$ 97',  period: '/mês' },
    annual:      { price: 78,  display: 'R$ 78',  period: '/mês', total: 'R$ 936/ano', saving: 'Economize R$ 228' },
    features: [
      { ok: true,  text: 'Até 3 usuários'             },
      { ok: true,  text: 'Até 5 prestadores'          },
      { ok: true,  text: 'Tarefas ilimitadas'         },
      { ok: true,  text: 'Bot Telegram'               },
      { ok: true,  text: 'Calendário e Dashboard'     },
      { ok: false, text: 'API / Integrações ERP'      },
      { ok: false, text: 'Relatórios avançados'       },
      { ok: false, text: 'Suporte prioritário'        },
    ],
  },
  {
    id:    'pro',
    name:  'Pro',
    color: 'var(--orange)',
    badge: '⭐ Mais popular',
    monthly:     { price: 197, display: 'R$ 197', period: '/mês' },
    annual:      { price: 158, display: 'R$ 158', period: '/mês', total: 'R$ 1.896/ano', saving: 'Economize R$ 468' },
    features: [
      { ok: true,  text: 'Usuários ilimitados'        },
      { ok: true,  text: 'Colaboradores ilimitados'   },
      { ok: true,  text: 'Tarefas ilimitadas'         },
      { ok: true,  text: 'Bot Telegram'               },
      { ok: true,  text: 'Tarefas com dados do cliente' },
      { ok: true,  text: 'Relatórios + PDF/XML'       },
      { ok: true,  text: 'Suporte via WhatsApp'       },
      { ok: false, text: 'Módulos Enterprise'         },
    ],
  },
  {
    id:    'enterprise',
    name:  'Enterprise',
    color: 'var(--purple)',
    badge: '🏢 Para grandes equipes',
    monthly:     { price: 497, display: 'R$ 497', period: '/mês' },
    annual:      { price: 398, display: 'R$ 398', period: '/mês', total: 'R$ 4.776/ano', saving: 'Economize R$ 1.188' },
    features: [
      { ok: true,  text: 'Tudo do Pro'                },
      { ok: true,  text: 'Controle de Clientes'       },
      { ok: true,  text: 'OS vinculada à agenda'      },
      { ok: true,  text: 'Orçamentos → conversão em tarefa' },
      { ok: true,  text: 'Controle de Caixa'          },
      { ok: true,  text: 'Pagamento de terceiros'     },
      { ok: true,  text: 'Relatório PDF automático'   },
      { ok: true,  text: 'Suporte prioritário'        },
    ],
  },
]

export default function Pricing({ session, trialDaysLeft, onSuccess }) {
  const [billing, setBilling] = useState('monthly') // 'monthly' | 'annual'
  const [loading, setLoading] = useState(null)
  const [error,   setError]   = useState('')

  const isAnnual = billing === 'annual'

  async function subscribe(planId) {
    setLoading(planId); setError('')
    try {
      const token = session?.access_token
      const priceId = isAnnual ? PRICES_ANNUAL[planId] : PRICES_MONTHLY[planId]

      if (priceId.includes('placeholder')) {
        setError('Plano anual ainda não configurado. Use o plano mensal ou contate o suporte.')
        setLoading(null); return
      }

      const res = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ plan: planId, billing }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        setError(data.error || 'Erro ao iniciar pagamento')
      }
    } catch {
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

        {/* Toggle mensal / anual */}
        <div className="pricing-toggle-wrap">
          <button
            className={`ptoggle-btn${!isAnnual ? ' active' : ''}`}
            onClick={() => setBilling('monthly')}
          >Mensal</button>
          <button
            className={`ptoggle-btn${isAnnual ? ' active' : ''}`}
            onClick={() => setBilling('annual')}
          >
            Anual
            <span className="ptoggle-save">20% OFF</span>
          </button>
        </div>
        {isAnnual && (
          <div className="pricing-annual-note">
            💡 Cobrado anualmente em parcela única · Equivale a <strong>2 meses grátis</strong>
          </div>
        )}

        {/* Cards */}
        <div className="pricing-grid">
          {PLANS.map(plan => {
            const info = isAnnual ? plan.annual : plan.monthly
            return (
              <div key={plan.id}
                className={`plan-card${plan.badge ? ' plan-featured' : ''}`}
                style={{ '--plan-color': plan.color }}
              >
                {plan.badge && <div className="plan-badge">{plan.badge}</div>}
                <div className="plan-name">{plan.name}</div>

                <div className="plan-price-wrap">
                  <div className="plan-price">
                    {info.display}
                    <span className="plan-period">{info.period}</span>
                  </div>
                  {isAnnual && (
                    <div className="plan-annual-detail">
                      <span className="plan-total">{info.total}</span>
                      <span className="plan-saving">{info.saving}</span>
                    </div>
                  )}
                  {!isAnnual && (
                    <div className="plan-monthly-hint">
                      ou <strong>12x R$ {plan.annual.price},00/mês</strong> no anual
                    </div>
                  )}
                </div>

                <ul className="plan-features">
                  {plan.features.map((f, i) => (
                    <li key={i} style={{ color: f.ok ? 'var(--text)' : 'var(--dim)' }}>
                      <span>{f.ok ? '✅' : '❌'}</span> {f.text}
                    </li>
                  ))}
                </ul>

                <button
                  className={`plan-btn${plan.badge ? ' plan-btn-featured' : ''}`}
                  onClick={() => subscribe(plan.id)}
                  disabled={loading === plan.id}
                  style={plan.badge ? { background: plan.color } : {}}
                >
                  {loading === plan.id
                    ? '⏳ Redirecionando…'
                    : isAnnual
                      ? `Assinar anual →`
                      : `Assinar mensal →`}
                </button>
              </div>
            )
          })}
        </div>

        {error && <div className="pricing-error">⚠ {error}</div>}

        <div className="pricing-footer">
          🔒 Pagamento seguro via Stripe &nbsp;·&nbsp; Cancele quando quiser &nbsp;·&nbsp;
          Sem taxa de cancelamento &nbsp;·&nbsp; Nota fiscal disponível
        </div>
      </div>
    </div>
  )
}
