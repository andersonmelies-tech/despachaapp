/**
 * Gerenciamento de tarefas recorrentes
 * Lista todas as regras, permite pausar/ativar/excluir
 * Botão "Nova Recorrência" abre modal de criação
 */
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'

const FREQ_LABEL = { daily: '📆 Diária', weekly: '📅 Semanal', weekly_custom: '📅 Dias Fixos', monthly: '🗓 Mensal' }
const DOW_LABEL  = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const URG_LABEL  = { critica: '🚨 Crítica', alta: '🔴 Alta', media: '🟡 Média', baixa: '🟢 Baixa' }
const DUR_OPTS   = [
  { value: 0,   label: 'Para sempre'  },
  { value: 30,  label: '30 dias'      },
  { value: 60,  label: '60 dias'      },
  { value: 120, label: '120 dias'     },
]
const DOW_OPTS = [
  { value: 1, label: 'Seg' }, { value: 2, label: 'Ter' }, { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' }, { value: 5, label: 'Sex' }, { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
]

function fmtDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function freqDesc(rec) {
  if (rec.frequency === 'daily')         return 'Todos os dias'
  if (rec.frequency === 'weekly')        return `Toda ${DOW_LABEL[rec.day_of_week ?? 5]}`
  if (rec.frequency === 'weekly_custom') {
    const dias = (rec.days_of_week || []).sort((a, b) => a - b).map(d => DOW_LABEL[d]).join(', ')
    return dias ? `Toda semana: ${dias}` : 'Dias não configurados'
  }
  if (rec.frequency === 'monthly')       return `Todo dia ${rec.day_of_month ?? 1} do mês`
  return '—'
}

// ── Modal de criação / edição ─────────────────────────────────────────────────
function RecurrenceModal({ rec, providers, sectors, onClose, onSave, showToast }) {
  const isEdit = !!rec?.id
  const [f, setF] = useState({
    title:            rec?.title            || '',
    description:      rec?.description      || '',
    requester:        rec?.requester        || '',
    requester_sector: rec?.requester_sector || '',
    assignee_id:      rec?.assignee_id      || '',
    assignee:         rec?.assignee         || '',
    urgency:          rec?.urgency          || 'media',
    category:         rec?.category         || '',
    sector:           rec?.sector           || '',
    frequency:        rec?.frequency        || 'weekly',
    day_of_week:      rec?.day_of_week      ?? 5,
    days_of_week:     rec?.days_of_week     || [],
    day_of_month:     rec?.day_of_month     ?? 1,
    skip_weekends:    rec?.skip_weekends    ?? null,  // null = usa padrão global
    dur:              0,   // apenas na criação
  })
  const [saving, setSaving] = useState(false)

  function set(k, v) { setF(p => ({ ...p, [k]: v })) }
  function toggleDay(d) {
    setF(p => {
      const arr = p.days_of_week || []
      return { ...p, days_of_week: arr.includes(d) ? arr.filter(x => x !== d) : [...arr, d] }
    })
  }

  function selectProvider(id) {
    const p = providers.find(p => p.id === Number(id))
    setF(prev => ({ ...prev, assignee_id: id ? Number(id) : null, assignee: p ? p.name : '' }))
  }

  async function save() {
    if (!f.title.trim())    return showToast('Título obrigatório', 'err')
    if (!f.requester.trim()) return showToast('Solicitante obrigatório', 'err')
    if (!f.assignee.trim()) return showToast('Colaborador obrigatório', 'err')
    if (!f.sector)          return showToast('Setor da tarefa obrigatório', 'err')
    if (f.frequency === 'weekly_custom' && f.days_of_week.length === 0)
      return showToast('Selecione pelo menos um dia da semana', 'err')
    setSaving(true)

    // Calcula end_date pela duração escolhida
    let end_date = null
    if (!isEdit && f.dur > 0) {
      const ed = new Date()
      ed.setDate(ed.getDate() + f.dur)
      end_date = ed.toISOString().split('T')[0]
    } else if (isEdit) {
      end_date = rec.end_date  // mantém
    }

    const { data: { session } } = await supabase.auth.getSession()

    const payload = {
      title:            f.title.trim(),
      description:      f.description.trim() || null,
      requester:        f.requester.trim(),
      requester_sector: f.requester_sector || null,
      assignee_id:      f.assignee_id || null,
      assignee:         f.assignee,
      urgency:          f.urgency,
      category:         f.category || null,
      sector:           f.sector   || null,
      frequency:        f.frequency,
      day_of_week:      f.frequency === 'weekly'        ? Number(f.day_of_week)  : null,
      days_of_week:     f.frequency === 'weekly_custom' ? f.days_of_week          : null,
      day_of_month:     f.frequency === 'monthly'       ? Number(f.day_of_month)  : null,
      skip_weekends:    f.frequency === 'daily'         ? f.skip_weekends         : null,
      end_date,
    }

    let recId = rec?.id
    let error

    if (isEdit) {
      // Reseta last_generated para que o gen-recurring regenere a partir de hoje
      // com os novos dias configurados (tarefas existentes são deduplicadas)
      const r = await supabase.from('task_recurrences').update({ ...payload, last_generated: null }).eq('id', rec.id)
      error = r.error
    } else {
      payload.start_date  = new Date().toISOString().split('T')[0]
      payload.company_id  = session?.user?.user_metadata?.company_id || null
      const r = await supabase.from('task_recurrences').insert(payload).select('id').single()
      error  = r.error
      recId  = r.data?.id
    }

    if (error) { showToast('Erro: ' + error.message, 'err'); setSaving(false); return }

    // Gera as tarefas imediatamente
    if (recId) {
      await fetch('/api/cron/gen-recurring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recurrence_id: recId }),
      }).catch(() => {})
    }

    setSaving(false)
    onSave()
  }

  return (
    <div className="overlay open" onClick={e => e.target.className === 'overlay open' && onClose()}>
      <div className="modal">
        <div className="mhead">
          <span className="mtitle">{isEdit ? `EDITAR RECORRÊNCIA #${rec.id}` : 'NOVA TAREFA RECORRENTE'}</span>
          <button className="mclose" onClick={onClose}>✕</button>
        </div>
        <div className="mbody">
          <div className="fgrid">

            {/* Título */}
            <div className="fg full">
              <label className="flabel">TÍTULO DA TAREFA *</label>
              <input className="finput" placeholder="Ex: Lavar caminhão, Verificar geradores…" value={f.title} onChange={e => set('title', e.target.value)} />
            </div>

            {/* Descrição */}
            <div className="fg full">
              <label className="flabel">DESCRIÇÃO</label>
              <textarea className="finput" placeholder="Detalhes, procedimentos…" value={f.description} onChange={e => set('description', e.target.value)} />
            </div>

            {/* Solicitante */}
            <div className="fg">
              <label className="flabel">SOLICITANTE *</label>
              <input className="finput" placeholder="Nome" value={f.requester} onChange={e => set('requester', e.target.value)} />
            </div>

            {/* Setor solicitante */}
            <div className="fg">
              <label className="flabel">SETOR DO SOLICITANTE</label>
              <select className="finput" value={f.requester_sector} onChange={e => set('requester_sector', e.target.value)}>
                <option value="">Selecione...</option>
                {sectors.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>

            {/* Setor da tarefa */}
            <div className="fg">
              <label className="flabel">SETOR DA TAREFA *</label>
              <select className="finput" value={f.sector} onChange={e => set('sector', e.target.value)}>
                <option value="">Selecione...</option>
                {sectors.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>

            {/* Colaborador */}
            <div className="fg">
              <label className="flabel">COLABORADOR *</label>
              <select className="finput" value={f.assignee_id || ''} onChange={e => selectProvider(e.target.value)}>
                <option value="">Selecione...</option>
                {providers.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            {/* Urgência */}
            <div className="fg">
              <label className="flabel">URGÊNCIA</label>
              <select className="finput" value={f.urgency} onChange={e => set('urgency', e.target.value)}>
                <option value="baixa">🟢 Baixa</option>
                <option value="media">🟡 Média</option>
                <option value="alta">🔴 Alta</option>
                <option value="critica">🚨 Crítica</option>
              </select>
            </div>

            {/* Categoria */}
            <div className="fg">
              <label className="flabel">CATEGORIA</label>
              <input className="finput" placeholder="Manutenção, Limpeza…" value={f.category} onChange={e => set('category', e.target.value)} />
            </div>

            {/* ── Configuração de recorrência ── */}
            <div className="fg full" style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '.25rem' }}>
              <div style={{ fontSize: '.72rem', color: 'var(--blue)', fontFamily: 'var(--mono)', letterSpacing: '.08em', marginBottom: '.85rem' }}>
                🔄 CONFIGURAÇÃO DE RECORRÊNCIA
              </div>

              {/* Frequência */}
              <label className="flabel">FREQUÊNCIA</label>
              <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                {[
                  { v: 'daily',         l: '📆 Diária'     },
                  { v: 'weekly',        l: '📅 Semanal'    },
                  { v: 'weekly_custom', l: '📅 Dias Fixos' },
                  { v: 'monthly',       l: '🗓 Mensal'     },
                ].map(opt => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => set('frequency', opt.v)}
                    style={{
                      flex: 1, padding: '.55rem', borderRadius: 8, border: '1.5px solid',
                      borderColor: f.frequency === opt.v ? 'var(--blue)' : 'var(--border)',
                      background:  f.frequency === opt.v ? '#3B82F615' : 'var(--s2)',
                      color:       f.frequency === opt.v ? 'var(--blue)' : 'var(--muted)',
                      fontWeight:  f.frequency === opt.v ? 700 : 400,
                      cursor: 'pointer', fontSize: '.8rem', transition: 'all .15s',
                    }}
                  >{opt.l}</button>
                ))}
              </div>

              {/* Pular fins de semana (daily) */}
              {f.frequency === 'daily' && (
                <div style={{ marginBottom: '1rem', padding: '.75rem 1rem', background: 'var(--s2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '.75rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={f.skip_weekends !== false}
                      onChange={e => set('skip_weekends', e.target.checked ? null : false)}
                      style={{ width: 16, height: 16, accentColor: 'var(--navy)', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: '.88rem', fontWeight: 600, color: 'var(--text)' }}>
                        Pular fins de semana (Sáb e Dom)
                      </div>
                      <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: '.1rem' }}>
                        {f.skip_weekends !== false
                          ? 'Seguirá o padrão definido nas Configurações da empresa'
                          : 'Esta recorrência vai gerar tarefas também no Sáb e Dom'}
                      </div>
                    </div>
                  </label>
                </div>
              )}

              {/* Dia da semana (weekly) */}
              {f.frequency === 'weekly' && (
                <div style={{ marginBottom: '1rem' }}>
                  <label className="flabel">DIA DA SEMANA</label>
                  <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
                    {DOW_OPTS.map(d => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => set('day_of_week', d.value)}
                        style={{
                          padding: '.45rem .75rem', borderRadius: 8, border: '1.5px solid',
                          borderColor: f.day_of_week === d.value ? 'var(--blue)' : 'var(--border)',
                          background:  f.day_of_week === d.value ? '#3B82F615' : 'var(--s2)',
                          color:       f.day_of_week === d.value ? 'var(--blue)' : 'var(--text)',
                          fontWeight:  f.day_of_week === d.value ? 700 : 400,
                          cursor: 'pointer', fontSize: '.82rem', transition: 'all .15s',
                        }}
                      >{d.label}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* Dias fixos da semana (weekly_custom — múltiplos dias) */}
              {f.frequency === 'weekly_custom' && (
                <div style={{ marginBottom: '1rem' }}>
                  <label className="flabel">DIAS DA SEMANA (selecione um ou mais)</label>
                  <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
                    {DOW_OPTS.map(d => {
                      const sel = (f.days_of_week || []).includes(d.value)
                      return (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() => toggleDay(d.value)}
                          style={{
                            padding: '.45rem .85rem', borderRadius: 8, border: '1.5px solid',
                            borderColor: sel ? 'var(--blue)' : 'var(--border)',
                            background:  sel ? '#3B82F615' : 'var(--s2)',
                            color:       sel ? 'var(--blue)' : 'var(--text)',
                            fontWeight:  sel ? 700 : 400,
                            cursor: 'pointer', fontSize: '.82rem', transition: 'all .15s',
                          }}
                        >{d.label}</button>
                      )
                    })}
                  </div>
                  {f.days_of_week.length > 0 && (
                    <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>
                      Gerará tarefas toda semana nas: {f.days_of_week.sort((a,b)=>a-b).map(d => DOW_LABEL[d]).join(', ')}
                    </div>
                  )}
                </div>
              )}

              {/* Dia do mês (monthly) */}
              {f.frequency === 'monthly' && (
                <div style={{ marginBottom: '1rem' }}>
                  <label className="flabel">DIA DO MÊS (1-28)</label>
                  <input
                    className="finput"
                    type="number"
                    min={1} max={28}
                    value={f.day_of_month}
                    onChange={e => set('day_of_month', Math.min(28, Math.max(1, Number(e.target.value))))}
                    style={{ maxWidth: 100 }}
                  />
                </div>
              )}

              {/* Duração (só na criação) */}
              {!isEdit && (
                <div>
                  <label className="flabel">DURAÇÃO</label>
                  <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                    {DUR_OPTS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => set('dur', opt.value)}
                        style={{
                          flex: 1, minWidth: 80, padding: '.5rem', borderRadius: 8, border: '1.5px solid',
                          borderColor: f.dur === opt.value ? 'var(--blue)' : 'var(--border)',
                          background:  f.dur === opt.value ? '#3B82F615' : 'var(--s2)',
                          color:       f.dur === opt.value ? 'var(--blue)' : 'var(--muted)',
                          fontWeight:  f.dur === opt.value ? 700 : 400,
                          cursor: 'pointer', fontSize: '.8rem', transition: 'all .15s',
                        }}
                      >{opt.label}</button>
                    ))}
                  </div>
                  <div style={{ fontSize: '.73rem', color: 'var(--muted)', marginTop: '.5rem' }}>
                    As tarefas serão geradas automaticamente na agenda com base nesta regra.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="mfoot">
          <button className="btn-sec" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Salvando…' : isEdit ? 'SALVAR ALTERAÇÕES' : '🔄 CRIAR RECORRÊNCIA'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Cache do módulo ────────────────────────────────────────────────────────────
const _rc = { recs: [], providers: [], sectors: [], loaded: false }

// ── Componente principal ────────────────────────────────────────────────────
export default function Recurrences({ showToast }) {
  const [recs,      setRecs]      = useState(_rc.recs)
  const [providers, setProviders] = useState(_rc.providers)
  const [sectors,   setSectors]   = useState(_rc.sectors)
  const [loading,   setLoading]   = useState(!_rc.loaded)
  const [modal,     setModal]     = useState(null)   // null | 'new' | rec object (edit)
  const [counts,    setCounts]    = useState({})     // recurrence_id → pending count
  const [toggling,  setToggling]  = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  async function load() {
    if (!_rc.loaded) setLoading(true)
    const [rr, pr, sr] = await Promise.all([
      supabase.from('task_recurrences').select('*').order('id', { ascending: false }),
      supabase.from('providers').select('*').eq('active', 1).order('name'),
      supabase.from('sectors').select('*').eq('active', 1).order('name'),
    ])
    if (!mountedRef.current) return

    _rc.recs      = rr.data || []
    _rc.providers = pr.data || []
    _rc.sectors   = sr.data || []
    _rc.loaded    = true
    setRecs(_rc.recs)
    setProviders(_rc.providers)
    setSectors(_rc.sectors)
    setLoading(false)

    // Carrega contagem de pendentes por recorrência
    if (_rc.recs.length > 0) {
      const ids = _rc.recs.map(r => r.id)
      const { data: pending } = await supabase
        .from('tasks')
        .select('recurrence_id')
        .in('recurrence_id', ids)
        .eq('status', 'pendente')
      if (!mountedRef.current) return
      const cnt = {}
      ;(pending || []).forEach(t => { cnt[t.recurrence_id] = (cnt[t.recurrence_id] || 0) + 1 })
      setCounts(cnt)
    }
  }

  useEffect(() => { load() }, [])

  async function toggleActive(rec) {
    setToggling(rec.id)
    const newActive = !rec.active

    const { error } = await supabase.from('task_recurrences')
      .update({ active: newActive })
      .eq('id', rec.id)

    if (error) { showToast('Erro: ' + error.message, 'err'); setToggling(null); return }

    // Ao pausar: cancela todas as tarefas pendentes futuras desta regra
    if (!newActive) {
      const today = new Date().toISOString().split('T')[0]
      await supabase.from('tasks')
        .update({ status: 'cancelada' })
        .eq('recurrence_id', rec.id)
        .eq('status', 'pendente')
        .gte('due_date', today)
      showToast(`Recorrência pausada — tarefas futuras canceladas`)
    } else {
      // Ao ativar: gera tarefas novamente
      await fetch('/api/cron/gen-recurring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recurrence_id: rec.id }),
      }).catch(() => {})
      showToast(`Recorrência ativada — novas tarefas geradas ✓`)
    }

    setToggling(null)
    _rc.loaded = false
    load()
  }

  async function deleteRec(rec) {
    if (!confirm(`Excluir a recorrência "${rec.title}"?\nAs tarefas futuras pendentes serão canceladas.`)) return
    const today = new Date().toISOString().split('T')[0]
    await supabase.from('tasks')
      .update({ status: 'cancelada' })
      .eq('recurrence_id', rec.id)
      .eq('status', 'pendente')
      .gte('due_date', today)
    await supabase.from('task_recurrences').delete().eq('id', rec.id)
    showToast(`Recorrência excluída`)
    _rc.loaded = false
    load()
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '.75rem' }}>
        <h2 style={{ fontFamily: 'var(--mono)', fontSize: '1rem', color: 'var(--blue)', letterSpacing: '.04em' }}>
          🔄 TAREFAS RECORRENTES
          {recs.length > 0 && (
            <span style={{ marginLeft: '.6rem', background: 'var(--blue)22', color: 'var(--blue)', borderRadius: 99, padding: '1px 8px', fontSize: '.7rem', fontWeight: 700 }}>
              {recs.filter(r => r.active).length} ativas
            </span>
          )}
        </h2>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button className="btn-sec" onClick={() => { _rc.loaded = false; load() }}>↻ Atualizar</button>
          <button className="btn-primary" onClick={() => setModal('new')}>+ Nova Recorrência</button>
        </div>
      </div>

      {/* Explicação */}
      <div className="cfg-card" style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem', fontSize: '.83rem', color: 'var(--muted)', lineHeight: 1.6 }}>
        📌 Tarefas recorrentes são geradas automaticamente na agenda. Ao pausar, as tarefas futuras são canceladas. Ao reativar, são geradas novamente.
      </div>

      {/* Lista */}
      {loading ? (
        <div className="cfg-card"><div className="empty">Carregando…</div></div>
      ) : recs.length === 0 ? (
        <div className="cfg-card">
          <div className="empty" style={{ padding: '2.5rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '.75rem' }}>🔄</div>
            <div>Nenhuma tarefa recorrente ainda.</div>
            <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginTop: '.35rem' }}>
              Crie uma para gerar tarefas automaticamente na agenda.
            </div>
            <button className="btn-primary" style={{ marginTop: '1rem' }} onClick={() => setModal('new')}>
              + Criar primeira recorrência
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
          {recs.map(rec => (
            <div key={rec.id} className="cfg-card" style={{ padding: '1rem 1.25rem', opacity: rec.active ? 1 : .65 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>

                {/* Info principal */}
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.35rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '.95rem' }}>{rec.title}</span>
                    <span style={{
                      fontSize: '.68rem', fontFamily: 'var(--mono)', letterSpacing: '.06em',
                      background: rec.active ? 'var(--green)22' : '#f3f4f6',
                      color: rec.active ? 'var(--green)' : 'var(--muted)',
                      border: `1px solid ${rec.active ? 'var(--green)44' : 'var(--border)'}`,
                      borderRadius: 99, padding: '2px 8px', fontWeight: 700,
                    }}>
                      {rec.active ? '● ATIVA' : '○ PAUSADA'}
                    </span>
                    <span style={{ fontSize: '.72rem', background: 'var(--blue)18', color: 'var(--blue)', borderRadius: 6, padding: '2px 7px' }}>
                      {FREQ_LABEL[rec.frequency]}
                    </span>
                  </div>

                  <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: '.2rem' }}>
                    🔁 {freqDesc(rec)}
                    {rec.end_date
                      ? <span> &nbsp;·&nbsp; até {fmtDate(rec.end_date)}</span>
                      : <span> &nbsp;·&nbsp; sem prazo final</span>
                    }
                  </div>

                  <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>
                    👤 {rec.assignee || '—'}
                    &nbsp;·&nbsp;
                    <span>{URG_LABEL[rec.urgency] || '🟡 Média'}</span>
                    {rec.category && <span>&nbsp;·&nbsp; {rec.category}</span>}
                    {counts[rec.id] > 0 && (
                      <span style={{ marginLeft: '.5rem', background: 'var(--warn)22', color: 'var(--warn)', borderRadius: 6, padding: '1px 6px', fontSize: '.7rem', fontWeight: 700 }}>
                        ⏳ {counts[rec.id]} pendente{counts[rec.id] > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>

                {/* Ações */}
                <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexShrink: 0 }}>
                  <button
                    className="btn-sec"
                    style={{ fontSize: '.78rem', padding: '.35rem .75rem' }}
                    onClick={() => setModal(rec)}
                  >
                    ✏ Editar
                  </button>
                  <button
                    className="btn-sec"
                    style={{ fontSize: '.78rem', padding: '.35rem .75rem', color: rec.active ? 'var(--warn)' : 'var(--green)' }}
                    onClick={() => toggleActive(rec)}
                    disabled={toggling === rec.id}
                  >
                    {toggling === rec.id ? '…' : rec.active ? '⏸ Pausar' : '▶ Ativar'}
                  </button>
                  <button
                    className="abtn r"
                    style={{ fontSize: '.78rem', padding: '.35rem .75rem' }}
                    onClick={() => deleteRec(rec)}
                  >
                    🗑
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <RecurrenceModal
          rec={modal === 'new' ? null : modal}
          providers={providers}
          sectors={sectors}
          showToast={showToast}
          onClose={() => setModal(null)}
          onSave={() => {
            setModal(null)
            _rc.loaded = false
            load()
            showToast('Recorrência salva — tarefas geradas na agenda ✓')
          }}
        />
      )}
    </div>
  )
}
