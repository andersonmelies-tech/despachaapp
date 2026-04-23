import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const STATUS_COLOR = {
  active:    'var(--green)',
  trialing:  'var(--blue)',
  trial:     'var(--blue)',
  past_due:  'var(--warn)',
  cancelled: 'var(--red)',
  canceled:  'var(--red)',
}
const STATUS_LABEL = {
  active:    '✅ Ativo',
  trialing:  '⏳ Trial',
  trial:     '⏳ Trial',
  past_due:  '⚠️ Inadimplente',
  cancelled: '❌ Cancelado',
  canceled:  '❌ Cancelado',
}
const PLAN_LABEL = { starter: 'Starter R$97', pro: 'Pro R$197', enterprise: 'Enterprise R$497', trial: 'Trial', paid: 'Pago' }

function daysLeft(date) {
  if (!date) return null
  const diff = new Date(date) - new Date()
  return Math.ceil(diff / 86400000)
}

function fmtDate(d) {
  if (!d) return '–'
  return new Date(d).toLocaleDateString('pt-BR')
}

export default function AdminPanel({ session }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('all')
  const [search,  setSearch]  = useState('')
  const [acting,  setActing]  = useState(null)

  async function load() {
    setLoading(true)
    const token = session?.access_token
    try {
      const res = await fetch('/api/admin/companies', {
        headers: { Authorization: `Bearer ${token}` }
      })
      const json = await res.json()
      if (json.error) { setData(null) } else { setData(json) }
    } catch { setData(null) }
    setLoading(false)
  }

  async function doAction(action, companyId, extra = {}) {
    setActing(companyId + action)
    const token = session?.access_token
    await fetch('/api/admin/companies', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, company_id: companyId, ...extra }),
    })
    await load()
    setActing(null)
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="empty">Carregando painel admin…</div>
  if (!data)   return <div className="empty adm-forbidden">🔒 Acesso restrito a administradores do sistema.</div>

  const { companies = [], mrr = 0 } = data

  const filtered = companies.filter(c => {
    if (filter === 'active'   && c.subscription_status !== 'active')   return false
    if (filter === 'trialing' && c.subscription_status !== 'trialing') return false
    if (filter === 'expired'  && (c.subscription_status === 'active' || c.subscription_status === 'trialing')) return false
    if (search && !c.name?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const totals = {
    total:    companies.length,
    active:   companies.filter(c => c.subscription_status === 'active').length,
    trialing: companies.filter(c => c.subscription_status === 'trialing' || c.subscription_status === 'trial').length,
    expired:  companies.filter(c => !['active','trialing','trial'].includes(c.subscription_status)).length,
  }

  return (
    <div className="adm-wrap">
      {/* Header */}
      <div className="adm-header">
        <div>
          <div className="adm-title">🛡️ Painel Administrador</div>
          <div className="adm-sub">Gerencie clientes, planos e receita</div>
        </div>
        <button className="btn-sec" onClick={load}>↻ Atualizar</button>
      </div>

      {/* KPIs */}
      <div className="adm-kpis">
        <div className="adm-kpi adm-kpi-mrr">
          <div className="adm-kpi-val">R$ {mrr.toLocaleString('pt-BR')}</div>
          <div className="adm-kpi-label">MRR Estimado</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-val">{totals.total}</div>
          <div className="adm-kpi-label">Total de empresas</div>
        </div>
        <div className="adm-kpi adm-kpi-active">
          <div className="adm-kpi-val">{totals.active}</div>
          <div className="adm-kpi-label">Assinantes ativos</div>
        </div>
        <div className="adm-kpi adm-kpi-trial">
          <div className="adm-kpi-val">{totals.trialing}</div>
          <div className="adm-kpi-label">Em trial</div>
        </div>
        <div className="adm-kpi adm-kpi-expired">
          <div className="adm-kpi-val">{totals.expired}</div>
          <div className="adm-kpi-label">Expirados/Cancelados</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="adm-filters">
        <div className="ctrl-row" style={{ marginBottom: 0 }}>
          <div className="search-wrap" style={{ maxWidth: 280 }}>
            <span>🔍</span>
            <input placeholder="Buscar empresa…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {['all','active','trialing','expired'].map(f => (
            <button key={f} className={`adm-ftab${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
              {{ all: 'Todas', active: '✅ Ativas', trialing: '⏳ Trial', expired: '❌ Expiradas' }[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Tabela de empresas */}
      <div className="adm-table-wrap">
        <div className="adm-tbl-head">
          <span>Empresa</span>
          <span>Plano</span>
          <span>Status</span>
          <span>Trial / Período</span>
          <span>Usuários</span>
          <span>Tarefas</span>
          <span>Cadastro</span>
          <span>Ações</span>
        </div>
        {filtered.length === 0 && <div className="empty">Nenhuma empresa encontrada</div>}
        {filtered.map(c => {
          const dl = daysLeft(c.trial_ends_at)
          const isTrialing = c.subscription_status === 'trialing' || c.subscription_status === 'trial'
          const isActive = c.subscription_status === 'active'
          return (
            <div key={c.id} className="adm-trow">
              <div className="adm-company-name">
                <div className="adm-co-avatar">{(c.name || '?')[0]}</div>
                <div>
                  <div className="adm-co-name">{c.name || '(sem nome)'}</div>
                  <div className="adm-co-id">ID: {c.id?.slice(0,8)}…</div>
                </div>
              </div>
              <div>
                <span className="adm-plan-badge">{PLAN_LABEL[c.plan] || c.plan || '–'}</span>
              </div>
              <div>
                <span className="adm-status-badge" style={{ color: STATUS_COLOR[c.subscription_status] || 'var(--muted)', borderColor: STATUS_COLOR[c.subscription_status] || 'var(--border)' }}>
                  {STATUS_LABEL[c.subscription_status] || c.subscription_status || '–'}
                </span>
              </div>
              <div className="adm-dates">
                {isTrialing && dl != null && (
                  <span style={{ color: dl <= 3 ? 'var(--red)' : dl <= 7 ? 'var(--warn)' : 'var(--muted)', fontSize: '.8rem' }}>
                    {dl > 0 ? `${dl} dias restantes` : 'Expirado'}
                  </span>
                )}
                {isActive && c.current_period_end && (
                  <span style={{ color: 'var(--muted)', fontSize: '.8rem' }}>Renova {fmtDate(c.current_period_end)}</span>
                )}
                {!isTrialing && !isActive && <span style={{ color: 'var(--muted)', fontSize: '.8rem' }}>–</span>}
              </div>
              <div className="adm-num">{c.users_count}</div>
              <div className="adm-num">{c.tasks_count}</div>
              <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{fmtDate(c.created_at)}</div>
              <div className="adm-actions">
                {/* Estender trial */}
                <button
                  className="abtn adm-act-btn"
                  title="Estender trial +7 dias"
                  disabled={!!acting}
                  onClick={() => doAction('extend_trial', c.id, { days: 7 })}
                >
                  {acting === c.id + 'extend_trial' ? '…' : '+7d'}
                </button>
                {/* Ativar manualmente */}
                {!isActive && (
                  <button
                    className="abtn g adm-act-btn"
                    title="Ativar plano pro manualmente"
                    disabled={!!acting}
                    onClick={() => doAction('activate', c.id, { plan: 'pro' })}
                  >
                    {acting === c.id + 'activate' ? '…' : '✓ Ativar'}
                  </button>
                )}
                {/* Cancelar */}
                {isActive && (
                  <button
                    className="abtn r adm-act-btn"
                    title="Cancelar assinatura"
                    disabled={!!acting}
                    onClick={() => { if (confirm(`Cancelar assinatura de ${c.name}?`)) doAction('cancel', c.id) }}
                  >
                    {acting === c.id + 'cancel' ? '…' : '✕'}
                  </button>
                )}
                {/* Link Stripe */}
                {c.stripe_customer_id && (
                  <a
                    href={`https://dashboard.stripe.com/customers/${c.stripe_customer_id}`}
                    target="_blank" rel="noreferrer"
                    className="abtn adm-act-btn"
                    title="Ver no Stripe"
                  >💳</a>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="adm-footer">
        {filtered.length} empresa{filtered.length !== 1 ? 's' : ''} exibida{filtered.length !== 1 ? 's' : ''}
        {mrr > 0 && <span> · MRR projetado: <strong style={{color:'var(--green)'}}>R$ {mrr.toLocaleString('pt-BR')}/mês</strong></span>}
      </div>
    </div>
  )
}
