import { useState, useEffect } from 'react'
import { supabase, isOverdue } from '../lib/supabase.js'
import TaskDetail, { TaskModal, URG_LABEL, STA_LABEL, URGENCIES, STATUSES, fmtDate } from './TaskDetail.jsx'

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
export default function Tasks({ showToast, sideFilter, user, plan }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [providers, setProviders] = useState([])
  const [sectors, setSectors] = useState([])
  const [slaConfig, setSlaConfig] = useState({})
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState(sideFilter !== 'atrasadas' && sideFilter !== 'criticas' && sideFilter !== 'all' ? sideFilter : '')
  const [filterUrgency, setFilterUrgency] = useState(sideFilter === 'criticas' ? 'critica' : '')
  const [filterSector, setFilterSector] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editTask, setEditTask] = useState(null)
  const [detailTask, setDetailTask] = useState(null)

  useEffect(() => { loadAll() }, [])
  useEffect(() => {
    if (sideFilter === 'all') { setFilterStatus(''); setFilterUrgency('') }
    else if (sideFilter === 'criticas') { setFilterStatus(''); setFilterUrgency('critica') }
    else if (sideFilter === 'atrasadas') { setFilterStatus(''); setFilterUrgency('') }
    else { setFilterStatus(sideFilter); setFilterUrgency('') }
  }, [sideFilter])

  async function loadAll() {
    setLoading(true)
    const [tr, pr, sr, slr] = await Promise.all([
      supabase.from('tasks').select('*').order('id', { ascending: false }),
      supabase.from('providers').select('*').eq('active', 1),
      supabase.from('sectors').select('*').eq('active', 1).order('name'),
      supabase.from('sla_config').select('*'),
    ])
    setTasks(tr.data || [])
    setProviders(pr.data || [])
    setSectors(sr.data || [])
    const sla = {}
    ;(slr.data || []).forEach(r => { sla[r.urgency] = r })
    setSlaConfig(sla)
    setLoading(false)
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
    return list.sort((a, b) => {
      const ord = { critica: 0, alta: 1, media: 2, baixa: 3 }
      return (ord[a.urgency] ?? 4) - (ord[b.urgency] ?? 4) || b.id - a.id
    })
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
          🔍
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
          <span>Urgência</span><span>Status</span><span>Prazo</span><span>Ações</span>
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
