import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase.js'
import Login from './components/Login.jsx'
import Topbar from './components/Topbar.jsx'
import Sidebar from './components/Sidebar.jsx'
import Dashboard from './components/Dashboard.jsx'
import Tasks from './components/Tasks.jsx'
import Calendar from './components/Calendar.jsx'
import Settings from './components/Settings.jsx'
import Toast from './components/Toast.jsx'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('dashboard')
  const [sideFilter, setSideFilter] = useState('all')
  const [toast, setToast] = useState({ msg: '', type: '', visible: false })
  const [stats, setStats] = useState(null)
  const [tasksKey, setTasksKey] = useState(0) // força re-render do Tasks

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
    })
    return () => subscription.unsubscribe()
  }, [])

  const showToast = useCallback((msg, type = 'ok') => {
    setToast({ msg, type, visible: true })
    setTimeout(() => setToast(t => ({ ...t, visible: false })), 3200)
  }, [])

  const refreshTasks = useCallback(() => setTasksKey(k => k + 1), [])

  const handleSideFilter = (f) => {
    setSideFilter(f)
    setTab('tasks')
  }

  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.8rem' }}>
      carregando...
    </div>
  )

  if (!session) return <Login onLogin={s => setSession(s)} showToast={showToast} />

  const user = session.user
  const meta = user.user_metadata || {}

  return (
    <>
      <Topbar
        tab={tab} setTab={setTab}
        user={meta}
        onLogout={() => supabase.auth.signOut()}
      />
      <div className="layout">
        <Sidebar
          tab={tab} setTab={setTab}
          sideFilter={sideFilter} setSideFilter={handleSideFilter}
          stats={stats}
        />
        <div className="main">
          {tab === 'dashboard' && (
            <Dashboard showToast={showToast} onStatsLoaded={setStats} refreshTasks={refreshTasks} />
          )}
          {tab === 'tasks' && (
            <Tasks
              key={tasksKey}
              showToast={showToast}
              sideFilter={sideFilter}
              user={meta}
              onStatsChange={() => setTasksKey(k => k + 1)}
            />
          )}
          {tab === 'calendar' && (
            <Calendar showToast={showToast} />
          )}
          {tab === 'settings' && (
            <Settings showToast={showToast} user={meta} session={session} />
          )}
        </div>
      </div>
      <Toast msg={toast.msg} type={toast.type} visible={toast.visible} />
    </>
  )
}
