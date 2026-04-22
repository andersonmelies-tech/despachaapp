import { useState, useEffect, useRef } from 'react'
import { supabase, calcSlaDeadline, isOverdue } from '../lib/supabase.js'

// ── helpers ───────────────────────────────────────────────────────────────────
export const URG_LABEL = { critica: '🚨 Crítica', alta: '🔴 Alta', media: '🟡 Média', baixa: '🟢 Baixa' }
export const STA_LABEL = { pendente: '⏳ Pendente', em_andamento: '🔧 Em andamento', concluida: '✅ Concluída', cancelada: '❌ Cancelada' }
export const URGENCIES = ['critica', 'alta', 'media', 'baixa']
export const STATUSES  = ['pendente', 'em_andamento', 'concluida', 'cancelada']

export function fmtMin(m) {
  if (!m) return '–'
  const h = Math.floor(m / 60), mi = m % 60
  return h ? `${h}h ${mi}min` : `${mi}min`
}
export function fmtDate(d) {
  if (!d) return '–'
  return new Date(d).toLocaleDateString('pt-BR')
}
export function fmtDatetime(d) {
  if (!d) return '–'
  return new Date(d).toLocaleString('pt-BR').slice(0, 16)
}
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

// ── TaskModal (criar/editar) ───────────────────────────────────────────────────
export function TaskModal({ task, providers, sectors, slaConfig, onClose, onSave }) {
  const isEdit = !!task?.id
  const [f, setF] = useState({
    title: task?.title || '',
    description: task?.description || '',
    requester: task?.requester || '',
    requester_sector: task?.requester_sector || '',
    assignee_id: task?.assignee_id || '',
    assignee: task?.assignee || '',
    urgency: task?.urgency || 'media',
    status: task?.status || 'pendente',
    category: task?.category || '',
    sector: task?.sector || '',
    due_date: task?.due_date || '',
    notes: task?.notes || '',
    photos: task?.photos ? JSON.parse(task.photos) : [],
  })
  const [saving, setSaving] = useState(false)
  const fileRef = useRef()

  function set(k, v) { setF(p => ({ ...p, [k]: v })) }

  function selectProvider(id) {
    const p = providers.find(p => p.id === Number(id))
    setF(prev => ({ ...prev, assignee_id: id ? Number(id) : null, assignee: p ? p.name : '' }))
  }

  async function addPhotos(files) {
    const newPhotos = []
    for (const file of files) {
      const compressed = await new Promise(resolve => {
        const img = new Image()
        const url = URL.createObjectURL(file)
        img.onload = () => {
          const MAX = 800
          let { width, height } = img
          if (width > MAX || height > MAX) {
            if (width >= height) { height = Math.round(height * MAX / width); width = MAX }
            else { width = Math.round(width * MAX / height); height = MAX }
          }
          const canvas = document.createElement('canvas')
          canvas.width = width; canvas.height = height
          canvas.getContext('2d').drawImage(img, 0, 0, width, height)
          URL.revokeObjectURL(url)
          resolve(canvas.toDataURL('image/jpeg', 0.65))
        }
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
        img.src = url
      })
      if (compressed) newPhotos.push(compressed)
    }
    setF(prev => ({ ...prev, photos: [...prev.photos, ...newPhotos] }))
  }

  async function save() {
    if (!f.title.trim()) return alert('Título obrigatório')
    if (!f.requester.trim()) return alert('Solicitante obrigatório')
    if (!f.assignee.trim()) return alert('Prestador obrigatório')
    setSaving(true)

    const now = new Date()
    const sla_deadline = isEdit ? task.sla_deadline : calcSlaDeadline(f.urgency, now)
    const resolvedDueDate = f.due_date
      ? f.due_date
      : (!isEdit ? sla_deadline.split('T')[0] : null)

    const payload = {
      title: f.title, description: f.description,
      requester: f.requester, requester_sector: f.requester_sector,
      assignee_id: f.assignee_id || null, assignee: f.assignee,
      urgency: f.urgency, status: f.status,
      category: f.category, sector: f.sector,
      due_date: resolvedDueDate,
      sla_deadline: isEdit ? task.sla_deadline : sla_deadline,
      notes: f.notes,
      photos: f.photos.length ? JSON.stringify(f.photos) : null,
    }

    if (isEdit && task.urgency !== f.urgency) {
      payload.sla_deadline = calcSlaDeadline(f.urgency, task.started_at ? new Date(task.started_at) : now)
    }

    if (isEdit) {
      if (f.status === 'em_andamento' && !task.started_at) payload.started_at = now.toISOString()
      if (f.status === 'concluida' && !task.completed_at) {
        payload.completed_at = now.toISOString()
        if (task.started_at) payload.elapsed_minutes = Math.round((now - new Date(task.started_at)) / 60000)
      }
    }

    let error
    if (isEdit) {
      const r = await supabase.from('tasks').update(payload).eq('id', task.id)
      error = r.error
      if (!error) {
        const changes = Object.entries(payload)
          .filter(([k, v]) => String(task[k] ?? '') !== String(v ?? '') && k !== 'updated_at')
        for (const [action, new_value] of changes) {
          await supabase.from('task_history').insert({ task_id: task.id, action, old_value: String(task[action] ?? ''), new_value: String(new_value ?? ''), changed_by: 'web' })
        }
      }
    } else {
      const r = await supabase.from('tasks').insert(payload).select().single()
      error = r.error
    }

    setSaving(false)
    if (error) { alert('Erro: ' + error.message); return }
    onSave()
  }

  return (
    <div className="overlay open" onClick={e => e.target.className === 'overlay open' && onClose()}>
      <div className="modal">
        <div className="mhead">
          <span className="mtitle">{isEdit ? `EDITAR TAREFA #${task.id}` : 'NOVA TAREFA'}</span>
          <button className="mclose" onClick={onClose}>✕</button>
        </div>
        <div className="mbody">
          <div className="fgrid">
            <div className="fg full">
              <label className="flabel">TÍTULO *</label>
              <input className="finput" placeholder="Descreva a tarefa…" value={f.title} onChange={e => set('title', e.target.value)} />
            </div>
            <div className="fg full">
              <label className="flabel">DESCRIÇÃO</label>
              <textarea className="finput" placeholder="Detalhes, local, observações…" value={f.description} onChange={e => set('description', e.target.value)} />
            </div>
            <div className="fg">
              <label className="flabel">SOLICITANTE *</label>
              <input className="finput" placeholder="Nome do solicitante" value={f.requester} onChange={e => set('requester', e.target.value)} />
            </div>
            <div className="fg">
              <label className="flabel">SETOR SOLICITANTE</label>
              <select className="finput" value={f.requester_sector} onChange={e => set('requester_sector', e.target.value)}>
                <option value="">Selecione...</option>
                {sectors.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div className="fg">
              <label className="flabel">PRESTADOR *</label>
              <select className="finput" value={f.assignee_id || ''} onChange={e => selectProvider(e.target.value)}>
                <option value="">Selecione...</option>
                {providers.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="fg">
              <label className="flabel">SETOR DA TAREFA</label>
              <select className="finput" value={f.sector} onChange={e => set('sector', e.target.value)}>
                <option value="">Selecione...</option>
                {sectors.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div className="fg">
              <label className="flabel">CATEGORIA</label>
              <input className="finput" placeholder="Elétrica, Hidráulica…" value={f.category} onChange={e => set('category', e.target.value)} />
            </div>
            <div className="fg">
              <label className="flabel">PRAZO (DATA DE CONCLUSÃO){!isEdit && <span className="flabel-hint"> — padrão: SLA</span>}</label>
              <input className="finput" type="date" value={f.due_date} onChange={e => set('due_date', e.target.value)} />
            </div>
            <div className="fg">
              <label className="flabel">URGÊNCIA</label>
              <select className="finput" value={f.urgency} onChange={e => set('urgency', e.target.value)}>
                <option value="baixa">🟢 Baixa</option>
                <option value="media">🟡 Média</option>
                <option value="alta">🔴 Alta</option>
                <option value="critica">🚨 Crítica</option>
              </select>
            </div>
            <div className="fg">
              <label className="flabel">STATUS</label>
              <select className="finput" value={f.status} onChange={e => set('status', e.target.value)}>
                <option value="pendente">⏳ Pendente</option>
                <option value="em_andamento">🔧 Em andamento</option>
                <option value="concluida">✅ Concluída</option>
                <option value="cancelada">❌ Cancelada</option>
              </select>
            </div>
            <div className="fg full">
              <label className="flabel">OBSERVAÇÕES</label>
              <textarea className="finput" style={{ minHeight: '55px' }} placeholder="Notas adicionais…" value={f.notes} onChange={e => set('notes', e.target.value)} />
            </div>
            <div className="fg full">
              <label className="flabel">FOTOS / ANEXOS</label>
              <div className="photo-upload-area" onClick={() => fileRef.current.click()}>
                <input ref={fileRef} type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={e => addPhotos(e.target.files)} />
                <div style={{ fontSize: '1.5rem', marginBottom: '.35rem' }}>📷</div>
                <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>Clique para adicionar fotos</div>
              </div>
              {f.photos.length > 0 && (
                <div className="photo-preview-grid">
                  {f.photos.map((src, i) => (
                    <div key={i} className="photo-thumb">
                      <img src={src} alt="" />
                      <button className="photo-thumb-del" onClick={() => setF(p => ({ ...p, photos: p.photos.filter((_, j) => j !== i) }))}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="mfoot">
          <button className="btn-sec" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'SALVAR TAREFA'}</button>
        </div>
      </div>
    </div>
  )
}

// ── TaskDetail (detalhe + histórico) ─────────────────────────────────────────
export default function TaskDetail({ task: initialTask, onClose, onUpdate, showToast }) {
  const [task, setTask] = useState(initialTask)
  const [history, setHistory] = useState([])
  const [editing, setEditing] = useState(false)
  const [providers, setProviders] = useState([])
  const [sectors, setSectors] = useState([])

  useEffect(() => {
    supabase.from('task_history').select('*').eq('task_id', task.id).order('changed_at', { ascending: false }).then(r => setHistory(r.data || []))
    supabase.from('providers').select('*').eq('active', 1).then(r => setProviders(r.data || []))
    supabase.from('sectors').select('*').eq('active', 1).order('name').then(r => setSectors(r.data || []))
  }, [task.id])

  async function approveNewDate() {
    const { data, error } = await supabase.from('tasks')
      .update({ due_date: task.provider_new_date, provider_new_date: null })
      .eq('id', task.id).select().single()
    if (error) { showToast('Erro ao aprovar data', 'err'); return }
    await supabase.from('task_history').insert({ task_id: task.id, action: 'due_date', old_value: task.due_date || '–', new_value: task.provider_new_date, changed_by: 'web' })
    setTask(data)
    onUpdate()
    showToast('Nova data de conclusão aprovada ✓')
  }

  async function rejectNewDate() {
    const { data, error } = await supabase.from('tasks')
      .update({ provider_new_date: null })
      .eq('id', task.id).select().single()
    if (error) { showToast('Erro ao recusar data', 'err'); return }
    await supabase.from('task_history').insert({ task_id: task.id, action: 'provider_new_date', old_value: task.provider_new_date, new_value: 'recusado', changed_by: 'web' })
    setTask(data)
    showToast('Nova data recusada')
  }

  async function changeStatus(newStatus) {
    const now = new Date().toISOString()
    const updates = { status: newStatus }
    if (newStatus === 'em_andamento' && !task.started_at) updates.started_at = now
    if (newStatus === 'concluida') {
      updates.completed_at = now
      if (task.started_at) updates.elapsed_minutes = Math.round((Date.now() - new Date(task.started_at)) / 60000)
    }
    const { data, error } = await supabase.from('tasks').update(updates).eq('id', task.id).select().single()
    if (error) { showToast('Erro ao atualizar', 'err'); return }
    await supabase.from('task_history').insert({ task_id: task.id, action: 'status', old_value: task.status, new_value: newStatus, changed_by: 'web' })
    setTask(data)
    onUpdate()
    showToast(STA_LABEL[newStatus] + ' ✓')
  }

  if (editing) {
    return (
      <TaskModal
        task={task} providers={providers} sectors={sectors} slaConfig={{}}
        onClose={() => setEditing(false)}
        onSave={() => {
          setEditing(false)
          supabase.from('tasks').select('*').eq('id', task.id).single().then(r => { if (r.data) setTask(r.data) })
          onUpdate()
          showToast('Tarefa atualizada ✓')
        }}
      />
    )
  }

  const late = isOverdue(task)

  return (
    <div className="overlay open" onClick={e => e.target.className === 'overlay open' && onClose()}>
      <div className="modal modal-lg">
        <div className="mhead">
          <span className="mtitle">TAREFA #{task.id}</span>
          <button className="mclose" onClick={onClose}>✕</button>
        </div>
        <div className="mbody">
          <div className="drow">
            <div>
              <div className="dlabel">TÍTULO</div>
              <div className="dval" style={{ fontWeight: 600 }}>{task.title}</div>
            </div>
            <div>
              <div className="dlabel">STATUS</div>
              <div className="dval"><span className={`stbadge ${task.status}`}>{STA_LABEL[task.status]}</span></div>
            </div>
          </div>
          {task.description && (
            <div style={{ marginBottom: '.85rem' }}>
              <div className="dlabel">DESCRIÇÃO</div>
              <div className="dval">{task.description}</div>
            </div>
          )}
          <div className="drow">
            <div><div className="dlabel">SOLICITANTE</div><div className="dval">{task.requester} {task.requester_sector && `· ${task.requester_sector}`}</div></div>
            <div><div className="dlabel">PRESTADOR</div><div className="dval">{task.assignee}</div></div>
          </div>
          <div className="drow">
            <div><div className="dlabel">URGÊNCIA</div><div className="dval"><span className={`ubadge ${task.urgency}`}>{URG_LABEL[task.urgency]}</span></div></div>
            <div><div className="dlabel">SETOR</div><div className="dval">{task.sector || '–'} {task.category && `· ${task.category}`}</div></div>
          </div>
          <div className="drow">
            <div><div className="dlabel">PRAZO</div><div className={`dval tdue ${late ? 'late' : 'ok'}`}>{fmtDate(task.due_date)}</div></div>
            <div><div className="dlabel">SLA</div><div className="dval" style={{ fontFamily: 'var(--mono)', fontSize: '.8rem' }}>{fmtDatetime(task.sla_deadline)}</div></div>
          </div>
          <div className="time-chips" style={{ marginBottom: '.85rem' }}>
            {task.created_at && <span className="chip">Criada: {fmtDatetime(task.created_at)}</span>}
            {task.started_at && <span className="chip accent">Iniciada: {fmtDatetime(task.started_at)}</span>}
            {task.completed_at && <span className="chip green">Concluída: {fmtDatetime(task.completed_at)}</span>}
            {task.elapsed_minutes && <span className="chip green">⏱ {fmtMin(task.elapsed_minutes)}</span>}
          </div>
          {task.notes && <div style={{ marginBottom: '.85rem' }}><div className="dlabel">OBSERVAÇÕES</div><div className="dval">{task.notes}</div></div>}

          {task.provider_obs && (
            <div style={{ marginBottom: '.85rem' }}>
              <div className="dlabel">💬 OBSERVAÇÕES DO PRESTADOR</div>
              <div className="provider-obs-box">{task.provider_obs}</div>
            </div>
          )}

          {task.provider_new_date && (
            <div style={{ marginBottom: '.85rem' }}>
              <div className="dlabel">📅 NOVA DATA PROPOSTA PELO PRESTADOR</div>
              <div className="provider-newdate-box">
                <div className="provider-newdate-info">
                  <span className="provider-newdate-val">{fmtDate(task.provider_new_date)}</span>
                  <span className="provider-newdate-caption">O prestador solicitou alteração do prazo de conclusão</span>
                </div>
                <div className="provider-newdate-actions">
                  <button className="btn-approve" onClick={approveNewDate}>✓ Aprovar</button>
                  <button className="btn-reject"  onClick={rejectNewDate}>✕ Recusar</button>
                </div>
              </div>
            </div>
          )}

          {task.photos && (() => {
            try {
              const photos = JSON.parse(task.photos)
              if (photos.length) return (
                <div style={{ marginBottom: '.85rem' }}>
                  <div className="dlabel">FOTOS</div>
                  <div className="photo-preview-grid" style={{ marginTop: '.5rem' }}>
                    {photos.map((src, i) => (
                      <div key={i} className="photo-thumb">
                        <img src={src} alt="" onClick={() => window.open(src)} />
                      </div>
                    ))}
                  </div>
                </div>
              )
            } catch {}
            return null
          })()}

          {history.length > 0 && (
            <div>
              <div className="dlabel" style={{ marginBottom: '.5rem' }}>HISTÓRICO</div>
              {history.map((h, i) => (
                <div key={i} className="hist-item">
                  <span className="hist-time">{fmtDatetime(h.changed_at)}</span>
                  <span><strong>{h.action}</strong>: {h.old_value || '–'} → {h.new_value || '–'} <span style={{ color: 'var(--dim)' }}>({h.changed_by})</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="mfoot">
          {task.status === 'pendente' && <button className="btn-primary" style={{ background: 'var(--blue)', color: '#fff' }} onClick={() => changeStatus('em_andamento')}>▶ INICIAR</button>}
          {task.status === 'em_andamento' && <button className="btn-primary" style={{ background: 'var(--green)', color: '#000' }} onClick={() => changeStatus('concluida')}>✅ CONCLUIR</button>}
          {!['concluida', 'cancelada'].includes(task.status) && <button className="btn-danger" onClick={() => changeStatus('cancelada')}>✕ Cancelar</button>}
          <button className="btn-sec" onClick={() => setEditing(true)}>✏ Editar</button>
          <button className="btn-sec" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  )
}
