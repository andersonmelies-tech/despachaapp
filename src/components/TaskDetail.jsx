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

const REC_DOW_OPTS = [
  { value: 1, label: 'Seg' }, { value: 2, label: 'Ter' }, { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' }, { value: 5, label: 'Sex' }, { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
]
const REC_DUR_OPTS = [
  { value: 0,   label: 'Para sempre' },
  { value: 30,  label: '30 dias'     },
  { value: 60,  label: '60 dias'     },
  { value: 120, label: '120 dias'    },
]

// ── TaskModal (criar/editar) ───────────────────────────────────────────────────
export function TaskModal({ task, providers, sectors, slaConfig, onClose, onSave, plan }) {
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
    client_name: task?.client_name || '',
    client_address: task?.client_address || '',
    task_type: task?.task_type || 'interno',
    client_id: task?.client_id || '',
  })
  // Recorrência (só na criação)
  const [recOn,   setRecOn]   = useState(false)
  const [recFreq, setRecFreq] = useState('weekly')
  const [recDow,  setRecDow]  = useState(5)   // Sexta por padrão
  const [recDom,  setRecDom]  = useState(1)
  const [recDur,  setRecDur]  = useState(0)   // 0 = para sempre

  const [saving, setSaving] = useState(false)
  const [clients, setClients] = useState([])
  const fileRef = useRef()

  useEffect(() => {
    if (plan === 'enterprise') {
      supabase.from('clients').select('id,name').eq('active', true).order('name')
        .then(r => setClients(r.data || []))
    }
  }, [plan])

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

    // ── CRIAÇÃO COM RECORRÊNCIA ──────────────────────────────────────────────
    if (!isEdit && recOn) {
      let end_date = null
      if (recDur > 0) {
        const ed = new Date()
        ed.setDate(ed.getDate() + recDur)
        end_date = ed.toISOString().split('T')[0]
      }
      const { data: { session } } = await supabase.auth.getSession()
      const { data: recRow, error: recErr } = await supabase.from('task_recurrences').insert({
        title:            f.title.trim(),
        description:      f.description.trim() || null,
        requester:        f.requester.trim(),
        requester_sector: f.requester_sector || null,
        assignee_id:      f.assignee_id || null,
        assignee:         f.assignee,
        urgency:          f.urgency,
        category:         f.category || null,
        sector:           f.sector   || null,
        frequency:        recFreq,
        day_of_week:      recFreq === 'weekly'  ? Number(recDow) : null,
        day_of_month:     recFreq === 'monthly' ? Number(recDom) : null,
        start_date:       new Date().toISOString().split('T')[0],
        end_date,
        company_id:       session?.user?.user_metadata?.company_id || null,
      }).select('id').single()
      if (recErr) { alert('Erro: ' + recErr.message); setSaving(false); return }
      // Gera as primeiras tarefas imediatamente
      fetch('/api/cron/gen-recurring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recurrence_id: recRow.id }),
      }).catch(() => {})
      setSaving(false)
      onSave()
      return
    }
    // ── FIM RECORRÊNCIA ──────────────────────────────────────────────────────

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
      client_name: f.client_name || null,
      client_address: f.client_address || null,
      task_type: f.task_type || 'interno',
      client_id: f.client_id || null,
    }

    if (isEdit && task.urgency !== f.urgency) {
      payload.sla_deadline = calcSlaDeadline(f.urgency, task.started_at ? new Date(task.started_at) : now)
    }

    if (isEdit) {
      // Primeira aprovação (pendente → em_andamento): SLA e prazo contam a partir de agora
      if (f.status === 'em_andamento' && task.status !== 'em_andamento') {
        payload.started_at   = now.toISOString()
        const newSla         = calcSlaDeadline(f.urgency, now)
        payload.sla_deadline = newSla
        payload.due_date     = newSla.split('T')[0]
      }
      if (f.status === 'concluida' && !task.completed_at) {
        payload.completed_at = now.toISOString()
        if (task.started_at) payload.elapsed_minutes = Math.round((now - new Date(task.started_at)) / 60000)
      }
      // Re-notifica o bot quando o colaborador é trocado ou atribuído pela primeira vez
      if (f.assignee_id && String(f.assignee_id) !== String(task.assignee_id || '')) {
        payload.provider_notified = false
      }
    }

    // Garante company_id no INSERT (não precisa no UPDATE pois a linha já existe)
    if (!isEdit) {
      const { data: { session } } = await supabase.auth.getSession()
      payload.company_id = session?.user?.user_metadata?.company_id || null
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
      // Notifica o prestador no Telegram (fire-and-forget)
      if (!error && r.data?.id) {
        fetch('/api/telegram/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: r.data.id }),
        }).catch(() => {})
      }
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
              <label className="flabel">COLABORADOR *</label>
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
            {/* Tipo de Serviço / Cliente — oculto durante testes de produção
            {(plan === 'pro' || plan === 'enterprise') && (
              <div className="fg full">
                <label className="flabel">TIPO DE SERVIÇO</label>
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  {['interno', 'externo'].map(type => (
                    <button key={type} type="button"
                      onClick={() => setF(p => ({ ...p, task_type: type }))}
                      style={{
                        flex: 1, padding: '.6rem', borderRadius: 8, border: '1px solid',
                        borderColor: f.task_type === type ? 'var(--blue)' : 'var(--border)',
                        background: f.task_type === type ? '#3B82F620' : 'var(--s2)',
                        color: f.task_type === type ? 'var(--blue)' : 'var(--muted)',
                        fontWeight: f.task_type === type ? 700 : 400,
                        cursor: 'pointer', fontSize: '.85rem', transition: 'all .15s',
                      }}>
                      {type === 'interno' ? '🏢 Interno' : '🌐 Externo'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            */}
            <div className="fg full">
              <label className="flabel">OBSERVAÇÕES</label>
              <textarea className="finput" style={{ minHeight: '55px' }} placeholder="Notas adicionais…" value={f.notes} onChange={e => set('notes', e.target.value)} />
            </div>
            {/* Campos de cliente externo — oculto durante testes de produção
            {f.task_type === 'externo' && (plan === 'pro' || plan === 'enterprise') && (
              <>
                <div className="fg">
                  <label className="flabel">NOME DO CLIENTE <span style={{ fontSize: '.65rem', background: 'var(--blue)', color: '#fff', borderRadius: 4, padding: '1px 5px', marginLeft: '.3rem', letterSpacing: '.03em' }}>PRO</span></label>
                  <input className="finput" placeholder="Nome do cliente" value={f.client_name} onChange={e => set('client_name', e.target.value)} />
                </div>
                <div className="fg">
                  <label className="flabel">ENDEREÇO DO CLIENTE <span style={{ fontSize: '.65rem', background: 'var(--blue)', color: '#fff', borderRadius: 4, padding: '1px 5px', marginLeft: '.3rem', letterSpacing: '.03em' }}>PRO</span></label>
                  <input className="finput" placeholder="Endereço do cliente" value={f.client_address} onChange={e => set('client_address', e.target.value)} />
                </div>
                {plan === 'enterprise' && (
                  <div className="fg full">
                    <label className="flabel">VINCULAR CLIENTE <span style={{fontSize:'.7rem',color:'var(--purple)',marginLeft:'.4rem'}}>ENTERPRISE</span></label>
                    <select className="finput" value={f.client_id || ''} onChange={e => setF(p => ({ ...p, client_id: e.target.value }))}>
                      <option value="">Selecione um cliente cadastrado...</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}
              </>
            )}
            */}
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

            {/* ── Recorrência (só na criação) ── */}
            {!isEdit && (
              <div className="fg full" style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '.65rem', cursor: 'pointer', userSelect: 'none', marginBottom: recOn ? '1rem' : 0 }}
                  onClick={() => setRecOn(v => !v)}
                >
                  <div style={{
                    width: 38, height: 22, borderRadius: 11, transition: 'background .2s',
                    background: recOn ? 'var(--blue)' : 'var(--border)',
                    position: 'relative', flexShrink: 0,
                  }}>
                    <div style={{
                      position: 'absolute', top: 3, left: recOn ? 18 : 3,
                      width: 16, height: 16, borderRadius: '50%', background: '#fff',
                      transition: 'left .2s', boxShadow: '0 1px 3px #0003',
                    }} />
                  </div>
                  <span style={{ fontSize: '.85rem', fontWeight: recOn ? 700 : 400, color: recOn ? 'var(--blue)' : 'var(--muted)' }}>
                    🔄 Tarefa recorrente
                  </span>
                </div>

                {recOn && (
                  <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '1rem', border: '1.5px solid var(--blue)33' }}>
                    {/* Frequência */}
                    <label className="flabel" style={{ marginBottom: '.5rem', display: 'block' }}>FREQUÊNCIA</label>
                    <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1rem' }}>
                      {[{ v: 'daily', l: '📆 Diária' }, { v: 'weekly', l: '📅 Semanal' }, { v: 'monthly', l: '🗓 Mensal' }].map(opt => (
                        <button key={opt.v} type="button" onClick={() => setRecFreq(opt.v)} style={{
                          flex: 1, padding: '.5rem', borderRadius: 8, border: '1.5px solid',
                          borderColor: recFreq === opt.v ? 'var(--blue)' : 'var(--border)',
                          background: recFreq === opt.v ? '#3B82F615' : 'var(--card)',
                          color: recFreq === opt.v ? 'var(--blue)' : 'var(--muted)',
                          fontWeight: recFreq === opt.v ? 700 : 400,
                          cursor: 'pointer', fontSize: '.78rem', transition: 'all .15s',
                        }}>{opt.l}</button>
                      ))}
                    </div>

                    {/* Dia da semana */}
                    {recFreq === 'weekly' && (
                      <div style={{ marginBottom: '1rem' }}>
                        <label className="flabel" style={{ marginBottom: '.45rem', display: 'block' }}>DIA DA SEMANA</label>
                        <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
                          {REC_DOW_OPTS.map(d => (
                            <button key={d.value} type="button" onClick={() => setRecDow(d.value)} style={{
                              padding: '.4rem .65rem', borderRadius: 7, border: '1.5px solid',
                              borderColor: recDow === d.value ? 'var(--blue)' : 'var(--border)',
                              background: recDow === d.value ? '#3B82F615' : 'var(--card)',
                              color: recDow === d.value ? 'var(--blue)' : 'var(--text)',
                              fontWeight: recDow === d.value ? 700 : 400,
                              cursor: 'pointer', fontSize: '.8rem', transition: 'all .15s',
                            }}>{d.label}</button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Dia do mês */}
                    {recFreq === 'monthly' && (
                      <div style={{ marginBottom: '1rem' }}>
                        <label className="flabel" style={{ marginBottom: '.45rem', display: 'block' }}>DIA DO MÊS (1–28)</label>
                        <input className="finput" type="number" min={1} max={28} value={recDom}
                          onChange={e => setRecDom(Math.min(28, Math.max(1, Number(e.target.value))))}
                          style={{ maxWidth: 100 }} />
                      </div>
                    )}

                    {/* Duração */}
                    <label className="flabel" style={{ marginBottom: '.45rem', display: 'block' }}>DURAÇÃO</label>
                    <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                      {REC_DUR_OPTS.map(opt => (
                        <button key={opt.value} type="button" onClick={() => setRecDur(opt.value)} style={{
                          flex: 1, minWidth: 72, padding: '.45rem', borderRadius: 7, border: '1.5px solid',
                          borderColor: recDur === opt.value ? 'var(--blue)' : 'var(--border)',
                          background: recDur === opt.value ? '#3B82F615' : 'var(--card)',
                          color: recDur === opt.value ? 'var(--blue)' : 'var(--muted)',
                          fontWeight: recDur === opt.value ? 700 : 400,
                          cursor: 'pointer', fontSize: '.78rem', transition: 'all .15s',
                        }}>{opt.label}</button>
                      ))}
                    </div>
                    <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: '.65rem' }}>
                      As tarefas serão geradas automaticamente e aparecerão na agenda.
                    </div>
                  </div>
                )}
              </div>
            )}
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
    // Busca completa da tarefa (inclui photos/description/notes que a lista omite)
    supabase.from('tasks').select('*').eq('id', initialTask.id).single()
      .then(({ data }) => { if (data) setTask(data) })

    supabase.from('task_history').select('*').eq('task_id', initialTask.id).order('changed_at', { ascending: false }).then(r => setHistory(r.data || []))
    supabase.from('providers').select('id,name,chat_id,active').eq('active', 1).then(r => setProviders(r.data || []))
    supabase.from('sectors').select('id,name,active').eq('active', 1).order('name').then(r => setSectors(r.data || []))

    // ── Realtime: atualiza o modal enquanto está aberto ──────────────────────
    const ch = supabase.channel(`rt-task-${task.id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `id=eq.${task.id}` },
        ({ new: updated, old: prev }) => {
          setTask(updated)
          onUpdate?.()
          // Recarrega histórico se houve mudança relevante
          if (updated.status !== prev.status || updated.provider_obs !== prev.provider_obs) {
            supabase.from('task_history').select('*').eq('task_id', task.id)
              .order('changed_at', { ascending: false }).then(r => setHistory(r.data || []))
          }
          // Toast para ações do colaborador via Telegram
          if (updated.provider_obs && updated.provider_obs !== prev.provider_obs)
            showToast(`💬 ${updated.assignee} adicionou uma observação`)
          if (updated.provider_new_date && updated.provider_new_date !== prev.provider_new_date)
            showToast(`📅 ${updated.assignee} propôs nova data`)
          if (updated.status !== prev.status && updated.status === 'em_andamento')
            showToast(`🔧 ${updated.assignee} iniciou a tarefa`)
          if (updated.status !== prev.status && updated.status === 'concluida')
            showToast(`✅ ${updated.assignee} concluiu a tarefa`)
        }
      )
      .subscribe()

    return () => supabase.removeChannel(ch)
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
            <div><div className="dlabel">COLABORADOR</div><div className="dval">{task.assignee}</div></div>
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
              <div className="dlabel">💬 OBSERVAÇÕES DO COLABORADOR</div>
              <div className="provider-obs-box">{task.provider_obs}</div>
            </div>
          )}

          {task.provider_new_date && (
            <div style={{ marginBottom: '.85rem' }}>
              <div className="dlabel">📅 NOVA DATA PROPOSTA PELO COLABORADOR</div>
              <div className="provider-newdate-box">
                <div className="provider-newdate-info">
                  <span className="provider-newdate-val">{fmtDate(task.provider_new_date)}</span>
                  <span className="provider-newdate-caption">O colaborador solicitou alteração do prazo de conclusão</span>
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
