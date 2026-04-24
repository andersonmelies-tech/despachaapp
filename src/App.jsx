import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase.js'
import Login       from './components/Login.jsx'
import LandingPage from './components/LandingPage.jsx'
import Topbar      from './components/Topbar.jsx'
import Sidebar     from './components/Sidebar.jsx'
import Dashboard   from './components/Dashboard.jsx'
import Tasks       from './components/Tasks.jsx'
import Calendar    from './components/Calendar.jsx'
import Reports     from './components/Reports.jsx'
import Settings    from './components/Settings.jsx'
import AdminPanel  from './components/AdminPanel.jsx'
import Toast       from './components/Toast.jsx'
import MobileNav   from './components/MobileNav.jsx'
import Pricing     from './components/Pricing.jsx'
import TrialBanner from './components/TrialBanner.jsx'
import Clients  from './components/Clients.jsx'
import Budgets  from './components/Budgets.jsx'
import CashFlow from './components/CashFlow.jsx'

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || 'admin@despachaapp.app'

function trialDaysLeft(trialEndsAt) {
  if (!trialEndsAt) return 14
  const diff = new Date(trialEndsAt) - new Date()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

export default function App() {
  const [session,     setSession]     = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [tab,         setTab]         = useState('dashboard')
  const [sideFilter,  setSideFilter]  = useState('all')
  const [toast,       setToast]       = useState({ msg: '', type: '', visible: false })
  const [stats,       setStats]       = useState(null)
  const [tasksKey,    setTasksKey]    = useState(0)
  const [company,     setCompany]     = useState(null)
  const [showPricing, setShowPricing] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  // Carrega dados da empresa (plano + trial)
  useEffect(() => {
    if (!session) return
    supabase.from('companies').select('*').single()
      .then(({ data }) => { if (data) setCompany(data) })
  }, [session])

  // Carrega branding da empresa
  useEffect(() => {
    if (!session) return
    supabase.from('config').select('key,value').in('key', ['brand_logo_url', 'brand_primary_color'])
      .then(({ data }) => {
        if (!data) return
        const cfg = Object.fromEntries(data.map(r => [r.key, r.value]))
        if (cfg.brand_primary_color) {
          document.documentElement.style.setProperty('--blue', cfg.brand_primary_color)
        }
      })
  }, [session])

  // Verifica retorno do Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('payment') === 'success') {
      showToast('🎉 Assinatura ativada com sucesso!')
      window.history.replaceState({}, '', '/')
      // Recarrega empresa para pegar novo status
      supabase.from('companies').select('*').single().then(({ data }) => { if (data) setCompany(data) })
    }
    if (params.get('payment') === 'cancelled') {
      showToast('Pagamento cancelado', 'err')
      window.history.replaceState({}, '', '/')
    }
  }, [])

  const showToast = useCallback((msg, type = 'ok') => {
    setToast({ msg, type, visible: true })
    setTimeout(() => setToast(t => ({ ...t, visible: false })), 3200)
  }, [])

  const handleSetTab = (t) => {
    setTab(t); if (t !== 'tasks') setSideFilter('all')
  }
  const handleSideFilter = (f) => { setSideFilter(f); setTab('tasks') }

  if (loading) return (
    <div className="loading-screen">
      <img src="/icon.png" alt="" style={{ width: 48, borderRadius: 12, marginBottom: '.75rem', opacity: .7 }} />
      <span>Carregando…</span>
    </div>
  )

  if (!session) return <LandingPage onLogin={s => setSession(s)} showToast={showToast} />

  const meta      = session.user?.user_metadata || {}
  const isSuperAdmin = session.user?.email === ADMIN_EMAIL || meta?.is_superadmin === true
  const plan    = company?.subscription_status
  const daysLeft = trialDaysLeft(company?.trial_ends_at)
  const isActive = plan === 'active' || plan === 'trialing' || daysLeft > 0

  // Gate: trial expirado e sem assinatura
  if (company && !isActive && !showPricing) {
    return (
      <>
        <Pricing
          session={session}
          trialDaysLeft={0}
          onSuccess={() => {
            supabase.from('companies').select('*').single().then(({ data }) => { if (data) setCompany(data) })
          }}
        />
        <Toast msg={toast.msg} type={toast.type} visible={toast.visible} />
      </>
    )
  }

  return (
    <>
      <Topbar user={meta} onLogout={() => supabase.auth.signOut()} />

      {/* Banner de trial — mostra quando ainda não é assinante ativo */}
      {company && plan !== 'active' && (
        <TrialBanner
          daysLeft={daysLeft}
          plan={plan === 'trialing' ? 'trial' : plan}
          onUpgrade={() => setShowPricing(true)}
        />
      )}

      {/* Modal de upgrade */}
      {showPricing && (
        <div className="modal-overlay-full" onClick={() => setShowPricing(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ textAlign: 'right', padding: '1rem 1rem 0' }}>
              <button className="mclose" onClick={() => setShowPricing(false)} style={{ fontSize: '1.2rem' }}>✕</button>
            </div>
            <Pricing session={session} trialDaysLeft={daysLeft} onSuccess={() => setShowPricing(false)} />
          </div>
        </div>
      )}

      <div className="layout">
        <Sidebar
          tab={tab}         setTab={handleSetTab}
          sideFilter={sideFilter} setSideFilter={handleSideFilter}
          stats={stats}    isSuperAdmin={isSuperAdmin}
          plan={plan}
        />
        <div className="main">
          {tab === 'dashboard' && <Dashboard showToast={showToast} onStatsLoaded={setStats} />}
          {tab === 'tasks'     && <Tasks key={tasksKey} showToast={showToast} sideFilter={sideFilter} user={meta} plan={plan} onStatsChange={() => setTasksKey(k => k + 1)} />}
          {tab === 'calendar'  && <Calendar showToast={showToast} />}
          {tab === 'reports'   && <Reports  showToast={showToast} />}
          {tab === 'settings'  && <Settings showToast={showToast} user={meta} session={session} />}
          {tab === 'admin'     && isSuperAdmin && <AdminPanel session={session} />}
          {tab === 'clients'  && <Clients  showToast={showToast} />}
          {tab === 'budgets'  && <Budgets  showToast={showToast} />}
          {tab === 'cashflow' && <CashFlow showToast={showToast} />}
        </div>
      </div>

      <MobileNav tab={tab} setTab={handleSetTab} stats={stats} />
      <Toast msg={toast.msg} type={toast.type} visible={toast.visible} />
    </>
  )
}
