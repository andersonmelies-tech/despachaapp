import { useState, useEffect, useRef } from 'react'
import { supabase, isOverdue } from '../lib/supabase.js'
import TaskDetail, { TaskModal, URG_LABEL, STA_LABEL, URGENCIES, STATUSES, fmtDate } from './TaskDetail.jsx'

// ── Cache em nível de módulo: sobrevive a trocas de aba ───────────────────────
// Ao voltar para Tarefas os dados aparecem instantaneamente enquanto atualiza em segundo plano
const _cache = { tasks: [], providers: [], sectors: [], slaConfig: {}, loaded: false }

function slaPercent(task) {
  if (!task.sla_deadline || !task.created_at) return 0
  const total = new Date(task.sla_deadline) - new Date(task.created_at)
  const elapsed = Date.now() - new Date(task.created_at)
  return Math.min(100, Math.max(0, (elapsed / total) * 100))
}
function slaColor(pct) {
  if (pct >= 90) return 'var(--red)'
  if (pct >= 70) return 'var(--warn)'
  return 'var(--green)'
}

// ── Tasks (lista principal) ────────────────────────────────────────────────────
export default function Tasks({ showToast, sideFilter, user, plan, onStatsChange }) {
  // Inicia com dados do cache para resposta imediata ao trocar de aba
  const [tasks,    setTasks]    = useState(_cache.tasks)
  const [loading,  setLoading]  = useState(!_cache.loaded)
  const [refreshing, setRefreshing] = useState(false)
  const [providers, setProviders] = useState(_cache.providers)
  const [sectors,   setSectors]   = useState(_cache.sectors)
  const [slaConfig, setSlaConfig] = useState(_cache.slaConfig)
  const [search,      setSearch]      = useState('')
  const [filterStatus,  setFilterStatus]  = useState(
    sideFilter !== 'atrasadas' && sideFilter !== 'criticas' && sideFilter !== 'all' ? sideFilter : ''
  )
  const [filterUrgency, setFilterUrgency] = useState(sideFilter === 'criticas' ? 'critica' : '')
  const [filterSector,  setFilterSector]  = useState('')
  const [filterAssignee,setFilterAssignee]= useState('')
  const [showModal,  setShowModal]  = useState(false)
  const [editTask,   setEditTask]   = useState(null)
  const [detailTask, setDetailTask] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    loadAll()

    // ── Realtime: atualização automática sem reload ────────────────────────────
    const ch = supabase.channel('rt-tasks')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks' },
        ({ new: t }) => {
          if (!mountedRef.current) return
          // Toast apenas para eventos externos (Telegram / formulário público)
          if (t.source === 'publico') showToast(`📥 Nova solicitação de ${t.requester}`)
          _cache.tasks = [t, ..._cache.tasks]
          setTasks([..._cache.tasks])
          onStatsChange?.()
        }
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks' },
        ({ new: t, old: o }) => {
          if (!mountedRef.current) return
          // Notificações de ações do colaborador via Telegram
          if (t.provider_obs && t.provider_obs !== o.provider_obs)
            showToast(`💬 ${t.assignee} comentou na tarefa #${t.id}`)
          if (t.provider_new_date && t.provider_new_date !== o.provider_new_date)
            showToast(`📅 ${t.assignee} propôs nova data para a tarefa #${t.id}`)
          if (t.status !== o.status && t.status === 'em_andamento')
            showToast(`🔧 ${t.assignee} iniciou a tarefa #${t.id}`)
          if (t.status !== o.status && t.status === 'concluida')
            showToast(`✅ ${t.assignee} concluiu a tarefa #${t.id}`)
          // Atualiza lista e modal aberto
          _cache.tasks = _cache.tasks.map(x => x.id === t.id ? t : x)
          setTasks([..._cache.tasks])
          setDetailTask(d => d?.id === t.id ? t : d)
          onStatsChange?.()
        }
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks' },
        ({ old: o }) => {
          if (!mountedRef.current) return
          _cache.tasks = _cache.tasks.filter(x => x.id !== o.id)
          setTasks([..._cache.tasks])
          onStatsChange?.()
        }
      )
      .subscribe()

    return () => {
      mountedRef.current = false
      supabase.removeChannel(ch)
    }
  }, [])

  useEffect(() => {
    if (sideFilter === 'all') { setFilterStatus(''); setFilterUrgency('') }
    else if (sideFilter === 'criticas') { setFilterStatus(''); setFilterUrgency('critica') }
    else if (sideFilter === 'atrasadas') { setFilterStatus(''); setFilterUrgency('') }
    else { setFilterStatus(sideFilter); setFilterUrgency('') }
  }, [sideFilter])

  async function loadAll() {
    // Se já tem cache, atualiza em segundo plano sem spinner
    if (_cache.loaded) setRefreshing(true)
    else setLoading(true)

    // Seleciona só as colunas necessárias para a LISTA — photos/description/notes
    // são carregadas sob demanda quando o usuário abre o detalhe da tarefa
    const LIST_COLS = 'id,title,status,urgency,due_date,sla_deadline,created_at,assignee,assignee_id,sector,source,needs_approval,requester,requester_phone,elapsed_minutes,recurrence_id,provider_new_date,company_id'
    const [tr, pr, sr, slr] = await Promise.all([
      supabase.from('tasks').select(LIST_COLS).order('id', { ascending: false }),
      supabase.from('providers').select('id,name,chat_id,active').eq('active', 1),
      supabase.from('sectors').select('id,name,active').eq('active', 1).order('name'),
      supabase.from('sla_config').select('*'),
    ])

    if (!mountedRef.current) return // componente desmontado entre tabs

    const tasks = tr.data || []
    const providers = pr.data || []
    const sectors = sr.data || []
    const sla = {}
    ;(slr.data || []).forEach(r => { sla[r.urgency] = r })

    // Atualiza cache do módulo
    _cache.tasks     = tasks
    _cache.providers = providers
    _cache.sectors   = sectors
    _cache.slaConfig = sla
    _cache.loaded    = true

    setTasks(tasks)
    setProviders(providers)
    setSectors(sectors)
    setSlaConfig(sla)
    setLoading(false)
    setRefreshing(false)

    // Notifica App.jsx para atualizar contadores do Dashboard/Sidebar
    onStatsChange?.()
  }

  function filtered() {
    let list = [...tasks]
    if (filterStatus) list = list.filter(t => t.status === filterStatus)
    if (filterUrgency) list = list.filter(t => t.urgency === filterUrgency)
    if (filterSector) list = list.filter(t => t.sector === filterSector || t.requester_sector === filterSector)
    if (filterAssignee) list = list.filter(t => t.assignee_id === Number(filterAssignee))
    if (sideFilter === 'atrasadas') list = list.filter(t => isOverdue(t))
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        t.requester.toLowerCase().includes(q) ||
        t.assignee.toLowerCase().includes(q)
      )
    }
    const statusOrd = { em_andamento: 0, pendente: 1, cancelada: 2, concluida: 3 }
    const urgOrd    = { critica: 0, alta: 1, media: 2, baixa: 3 }
    return list.sort((a, b) =>
      (statusOrd[a.status] ?? 4) - (statusOrd[b.status] ?? 4) ||
      (urgOrd[a.urgency]   ?? 4) - (urgOrd[b.urgency]   ?? 4) ||
      b.id - a.id
    )
  }

  async function deleteTask(id) {
    if (!confirm('Excluir esta tarefa?')) return
    await supabase.from('tasks').delete().eq('id', id)
    showToast('Tarefa excluída')
    loadAll()
  }

  const list = filtered()

  return (
    <div>
      {/* Controles */}
      <div className="ctrl-row">
        <div className="search-wrap">
          {refreshing ? <span style={{ fontSize: '.75rem', animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span> : '🔍'}
          <input placeholder="Buscar tarefas…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">Todos status</option>
          {STATUSES.map(s => <option key={s} value={s}>{STA_LABEL[s]}</option>)}
        </select>
        <select value={filterUrgency} onChange={e => setFilterUrgency(e.target.value)}>
          <option value="">Todas urgências</option>
          {URGENCIES.map(u => <option key={u} value={u}>{URG_LABEL[u]}</option>)}
        </select>
        <select value={filterSector} onChange={e => setFilterSector(e.target.value)}>
          <option value="">Todos setores</option>
          {sectors.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
        <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
          <option value="">Todos colaboradores</option>
          {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn-primary" onClick={() => { setEditTask(null); setShowModal(true) }}>+ Nova Tarefa</button>
      </div>

      {/* Tabela */}
      <div className="tbl-wrap">
        <div className="tbl-head">
          <span>#</span><span>Tarefa</span><span>Colaborador</span>
          <span>Urgência</span><span>Status</span><span>Solicitação</span><span>Prazo</span><span>Ações</span>
        </div>
        {loading ? (
          <div className="empty">Carregando…</div>
        ) : list.length === 0 ? (
          <div className="empty">Nenhuma tarefa encontrada</div>
        ) : list.map(t => {
          const late = isOverdue(t)
          const pct = slaPercent(t)
          const isActive = !['concluida','cancelada'].includes(t.status)
          return (
            <div
              key={t.id}
              className={`trow${late ? ' is-late' : ''}${t.urgency === 'critica' && isActive ? ' is-critical' : ''}`}
              onClick={() => setDetailTask(t)}
            >
              <span className="tid">#{t.id}</span>
              <span>
                <div className="ttitle">{t.title}{t.task_type === 'externo' && <span style={{ marginLeft: '.35rem', fontSize: '.72rem', color: 'var(--blue)' }} title="Tarefa externa">🌐</span>}
                  <small>
                    {t.requester} {t.sector && `· ${t.sector}`}
                    {t.provider_new_date && <span className="pnd-badge" title="Colaborador propôs nova data"> 📅</span>}
                    {t.provider_obs      && <span className="pnd-badge" title="Colaborador adicionou observação"> 💬</span>}
                  </small>
                  {t.client_name && <small style={{ display: 'block', color: 'var(--blue)', fontSize: '.72rem', marginTop: '.1rem' }}>👤 {t.client_name}</small>}
                </div>
              </span>
              <span className="tassignee">{t.assignee}</span>
              <span><span className={`ubadge ${t.urgency}`}>{URG_LABEL[t.urgency]}</span></span>
              <span>
                <span className={`stbadge ${t.status}`}>{STA_LABEL[t.status]}</span>
                {isActive && (
                  <div className="sla-bar-wrap">
                    <div className="sla-bar" style={{ width: pct + '%', background: slaColor(pct) }} />
                  </div>
                )}
              </span>
              <span className="tdue ok" style={{ color: 'var(--muted)', fontSize: '.8rem' }}>{fmtDate(t.created_at)}</span>
              <span className={`tdue ${late && isActive ? 'late' : 'ok'}`}>{fmtDate(t.due_date)}</span>
              <span className="actions" onClick={e => e.stopPropagation()}>
                <button className="abtn b" onClick={() => setDetailTask(t)}>👁</button>
                <button className="abtn" onClick={() => { setEditTask(t); setShowModal(true) }}>✏</button>
                {user?.role === 'admin' && (
                  <button className="abtn r" onClick={() => deleteTask(t.id)}>🗑</button>
                )}
              </span>
            </div>
          )
        })}
      </div>

      {/* Modals */}
      {showModal && (
        <TaskModal
          task={editTask}
          providers={providers}
          sectors={sectors}
          slaConfig={slaConfig}
          plan={plan}
          onClose={() => { setShowModal(false); setEditTask(null) }}
          onSave={() => {
            setShowModal(false); setEditTask(null)
            showToast(editTask ? 'Tarefa atualizada ✓' : 'Tarefa criada ✓')
            loadAll()
          }}
        />
      )}
      {detailTask && (
        <TaskDetail
          task={detailTask}
          onClose={() => setDetailTask(null)}
          onUpdate={loadAll}
          showToast={showToast}
        />
      )}
    </div>
  )
}
