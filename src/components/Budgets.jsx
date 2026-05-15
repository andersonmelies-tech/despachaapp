import { useState, useEffect, useRef } from 'react'
import { supabase, getCompanyId } from '../lib/supabase.js'

const STATUS_CFG = {
  pendente:   { label: 'Pendente',   color: 'var(--warn)',   icon: '⏳' },
  aprovado:   { label: 'Aprovado',   color: 'var(--green)',  icon: '✅' },
  recusado:   { label: 'Recusado',   color: 'var(--red)',    icon: '❌' },
  convertido: { label: 'Convertido', color: 'var(--purple)', icon: '🔄' },
}

function fmt(v) { return v ? new Date(v + 'T12:00:00').toLocaleDateString('pt-BR') : '—' }
function fmtMoney(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// ── Campo de valor com máscara R$ xx.xxx,xx ───────────────────────────────────
function CurrencyInput({ value, onChange, placeholder = 'R$ 0,00' }) {
  const [display, setDisplay] = useState('')
  const inputRef = useRef()

  // Sincroniza display quando value muda externamente
  useEffect(() => {
    if (value === '' || value == null) { setDisplay(''); return }
    const num = Number(value)
    if (!isNaN(num) && num > 0) {
      setDisplay(num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
    }
  }, [value])

  function handleChange(e) {
    const raw = e.target.value.replace(/[^\d]/g, '') // somente dígitos
    if (!raw) { setDisplay(''); onChange(''); return }
    const num = parseInt(raw, 10) / 100                // centavos → reais
    const formatted = num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    setDisplay(formatted)
    onChange(String(num))
  }

  function handleFocus() {
    // Ao focar, mostra apenas dígitos formatados (sem prefixo R$)
  }

  return (
    <div style={{ position: 'relative' }}>
      <span style={{
        position: 'absolute', left: '.75rem', top: '50%', transform: 'translateY(-50%)',
        color: 'var(--muted)', fontSize: '.85rem', pointerEvents: 'none', fontFamily: 'var(--mono)',
      }}>R$</span>
      <input
        ref={inputRef}
        className="finput"
        style={{ paddingLeft: '2.2rem', fontFamily: 'var(--mono)', textAlign: 'right', letterSpacing: '.03em' }}
        value={display}
        onChange={handleChange}
        onFocus={handleFocus}
        placeholder="0,00"
        inputMode="numeric"
      />
    </div>
  )
}

export default function Budgets({ showToast }) {
  const [budgets,      setBudgets]      = useState([])
  const [clients,      setClients]      = useState([])
  const [modal,        setModal]        = useState(false)
  const [editing,      setEditing]      = useState(null)
  const [saving,       setSaving]       = useState(false)
  const [approving,    setApproving]    = useState(null)   // aprovação direta → OS
  const [converting,   setConverting]   = useState(null)   // → Tarefa
  const [refusing,     setRefusing]     = useState(null)   // recusar
  const [f, setF] = useState({
    title: '', description: '', client_id: '', amount: '',
    labor_value: '', materials_value: '',
    status: 'pendente', due_date: ''
  })

  async function load() {
    const [br, cr] = await Promise.all([
      supabase.from('budgets').select('*, clients(name)').order('created_at', { ascending: false }),
      supabase.from('clients').select('id, name').eq('active', true).order('name'),
    ])
    setBudgets(br.data || [])
    setClients(cr.data || [])
  }
  useEffect(() => { load() }, [])

  function openNew() {
    setEditing(null)
    setF({ title: '', description: '', client_id: '', amount: '', labor_value: '', materials_value: '', status: 'pendente', due_date: '' })
    setModal(true)
  }
  function openEdit(b) {
    setEditing(b)
    setF({
      title:           b.title,
      description:     b.description || '',
      client_id:       b.client_id || '',
      amount:          b.amount ? String(b.amount) : '',
      labor_value:     b.labor_value ? String(b.labor_value) : '',
      materials_value: b.materials_value ? String(b.materials_value) : '',
      status:          b.status,
      due_date:        b.due_date || '',
    })
    setModal(true)
  }

  // Recalcula total quando mão de obra ou materiais mudam
  function setLabor(v) {
    const labor = Number(v) || 0
    const mats  = Number(f.materials_value) || 0
    setF(p => ({ ...p, labor_value: v, amount: labor + mats > 0 ? String(labor + mats) : p.amount }))
  }
  function setMaterials(v) {
    const labor = Number(f.labor_value) || 0
    const mats  = Number(v) || 0
    setF(p => ({ ...p, materials_value: v, amount: labor + mats > 0 ? String(labor + mats) : p.amount }))
  }

  async function save() {
    if (!f.title.trim()) return showToast('Título obrigatório', 'err')
    setSaving(true)
    const payload = {
      title:           f.title,
      description:     f.description,
      client_id:       f.client_id || null,
      labor_value:     Number(f.labor_value) || 0,
      materials_value: Number(f.materials_value) || 0,
      amount:          Number(f.amount) || 0,
      status:          f.status,
      due_date:        f.due_date || null,
    }
    if (editing) {
      const { error } = await supabase.from('budgets').update(payload).eq('id', editing.id)
      if (error) { showToast('Erro: ' + error.message, 'err'); setSaving(false); return }
    } else {
      payload.company_id = await getCompanyId()
      const { error } = await supabase.from('budgets').insert(payload)
      if (error) { showToast('Erro: ' + error.message, 'err'); setSaving(false); return }
    }
    showToast(editing ? 'Orçamento atualizado ✓' : 'Orçamento criado ✓')
    setSaving(false); setModal(false); load()
  }

  // ── Aprovar diretamente + criar OS automaticamente ────────────────────────
  async function approveAndCreateOS(b) {
    if (!confirm(`Aprovar o orçamento "${b.title}" e criar OS automaticamente?`)) return
    setApproving(b.id)
    const company_id = await getCompanyId()

    // 1. Cria a OS herdando mão de obra e materiais do orçamento
    const { data: os, error: osErr } = await supabase.from('service_orders').insert({
      title:           b.title,
      description:     b.description || '',
      client_id:       b.client_id || null,
      total_value:     Number(b.amount) || 0,
      labor_value:     Number(b.labor_value) || 0,
      materials_value: Number(b.materials_value) || 0,
      status:          'aberta',
      budget_id:       b.id,
      company_id,
    }).select().single()

    if (osErr) {
      showToast('Erro ao criar OS: ' + osErr.message, 'err')
      setApproving(null)
      return
    }

    // 2. Atualiza orçamento para aprovado + convertido
    await supabase.from('budgets').update({
      status:           'convertido',
      service_order_id: os.id,
    }).eq('id', b.id)

    showToast(`✅ Aprovado! OS ${os.os_number} criada com sucesso 🎉`)
    setApproving(null)
    load()
  }

  // ── Recusar orçamento ─────────────────────────────────────────────────────
  async function refuse(b) {
    if (!confirm(`Recusar o orçamento "${b.title}"?`)) return
    setRefusing(b.id)
    await supabase.from('budgets').update({ status: 'recusado' }).eq('id', b.id)
    showToast('Orçamento recusado')
    setRefusing(null); load()
  }

  // ── Converter aprovado em Tarefa ──────────────────────────────────────────
  async function convertToTask(b) {
    setConverting(b.id)
    const company_id = await getCompanyId()
    const { data, error } = await supabase.from('tasks').insert({
      title:       b.title,
      description: b.description || '',
      requester:   b.clients?.name || 'Cliente',
      client_name: b.clients?.name || '',
      urgency:     'media',
      status:      'pendente',
      company_id,
    }).select().single()
    if (error) { showToast('Erro ao converter', 'err'); setConverting(null); return }
    await supabase.from('budgets').update({ status: 'convertido', task_id: data.id }).eq('id', b.id)
    showToast('Orçamento convertido em tarefa ✓ 🎉')
    setConverting(null); load()
  }

  // ── KPIs rápidos ─────────────────────────────────────────────────────────
  const totalPendente   = budgets.filter(b => b.status === 'pendente').reduce((a, b) => a + Number(b.amount), 0)
  const totalAprovado   = budgets.filter(b => b.status === 'aprovado').reduce((a, b) => a + Number(b.amount), 0)
  const totalConvertido = budgets.filter(b => b.status === 'convertido').reduce((a, b) => a + Number(b.amount), 0)

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '.75rem' }}>
        <h2 style={{ fontFamily: 'var(--mono)', fontSize: '1rem', color: 'var(--green)', letterSpacing: '.04em' }}>💰 ORÇAMENTOS</h2>
        <button className="btn-primary" onClick={openNew}>+ Novo Orçamento</button>
      </div>

      {/* KPIs */}
      {budgets.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.65rem', marginBottom: '1rem' }}>
          {[
            { label: 'Pendentes',   val: totalPendente,   color: 'var(--warn)' },
            { label: 'Aprovados',   val: totalAprovado,   color: 'var(--green)' },
            { label: 'Convertidos', val: totalConvertido, color: 'var(--purple)' },
          ].map(k => (
            <div key={k.label} className="cfg-card" style={{ padding: '.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{k.label}</span>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 800, color: k.color, fontSize: '1rem' }}>{fmtMoney(k.val)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tabela */}
      <div className="cfg-card" style={{ overflowX: 'auto' }}>
        {budgets.length === 0 ? <div className="empty">Nenhum orçamento cadastrado</div> : (
          <table className="rep-table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Cliente</th>
                <th>Valor</th>
                <th>Prazo</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map(b => {
                const sc = STATUS_CFG[b.status] || STATUS_CFG.pendente
                const isPendente  = b.status === 'pendente'
                const isAprovado  = b.status === 'aprovado'
                return (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600 }}>{b.title}</td>
                    <td style={{ color: 'var(--muted)', fontSize: '.85rem' }}>{b.clients?.name || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--green)' }}>{fmtMoney(b.amount)}</div>
                      {(Number(b.labor_value) > 0 || Number(b.materials_value) > 0) && (
                        <div style={{ fontSize: '.68rem', color: 'var(--muted)', marginTop: '.1rem', display: 'flex', gap: '.4rem' }}>
                          {Number(b.labor_value) > 0 && <span>🔧 {fmtMoney(b.labor_value)}</span>}
                          {Number(b.materials_value) > 0 && <span>🪛 {fmtMoney(b.materials_value)}</span>}
                        </div>
                      )}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--muted)', fontSize: '.8rem' }}>{fmt(b.due_date)}</td>
                    <td>
                      <span style={{
                        background: sc.color + '22', color: sc.color,
                        padding: '.2rem .6rem', borderRadius: 6,
                        fontSize: '.75rem', fontWeight: 600, whiteSpace: 'nowrap'
                      }}>
                        {sc.icon} {sc.label}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '.3rem', alignItems: 'center', flexWrap: 'nowrap' }}>
                        {/* Editar — somente pendentes e aprovados */}
                        {!['convertido'].includes(b.status) && (
                          <button className="abtn" onClick={() => openEdit(b)} title="Editar">✏</button>
                        )}

                        {/* Botão principal: Aprovar → OS (para pendentes) */}
                        {isPendente && (
                          <button
                            className="btn-primary"
                            style={{
                              fontSize: '.72rem', padding: '.28rem .7rem',
                              background: 'var(--green)', borderColor: 'var(--green)',
                              whiteSpace: 'nowrap',
                            }}
                            onClick={() => approveAndCreateOS(b)}
                            disabled={approving === b.id}
                          >
                            {approving === b.id ? '⏳' : '✅ Aprovar → OS'}
                          </button>
                        )}

                        {/* Recusar (para pendentes) */}
                        {isPendente && (
                          <button className="abtn r" style={{ fontSize: '.7rem', padding: '.2rem .45rem' }}
                            onClick={() => refuse(b)} disabled={refusing === b.id} title="Recusar">
                            {refusing === b.id ? '⏳' : '✕'}
                          </button>
                        )}

                        {/* Converter em tarefa (para aprovados ainda não convertidos) */}
                        {isAprovado && (
                          <button className="abtn" style={{ color: 'var(--blue)', fontSize: '.7rem', padding: '.2rem .45rem' }}
                            onClick={() => convertToTask(b)} disabled={converting === b.id}>
                            {converting === b.id ? '⏳' : '→ Tarefa'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal criar/editar */}
      {modal && (
        <div className="overlay open" onClick={e => e.target.className === 'overlay open' && setModal(false)}>
          <div className="modal" style={{ maxWidth: 560 }}>
            <div className="mhead">
              <span className="mtitle">{editing ? 'EDITAR ORÇAMENTO' : 'NOVO ORÇAMENTO'}</span>
              <button className="mclose" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="mbody">
              <div className="fgrid">

                <div className="fg full">
                  <label className="flabel">TÍTULO *</label>
                  <input className="finput" value={f.title}
                    onChange={e => setF(p => ({ ...p, title: e.target.value }))}
                    placeholder="Ex: Manutenção elétrica — Galpão A" autoFocus />
                </div>

                <div className="fg">
                  <label className="flabel">CLIENTE</label>
                  <select className="finput" value={f.client_id}
                    onChange={e => setF(p => ({ ...p, client_id: e.target.value }))}>
                    <option value="">Selecione...</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                {/* ── Valores ── */}
                <div className="fg full">
                  <div style={{ borderTop: '1px solid var(--border)', margin: '.1rem 0 .6rem', opacity: .4 }} />
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)', letterSpacing: '.08em', fontFamily: 'var(--mono)', marginBottom: '.5rem' }}>
                    💰 COMPOSIÇÃO DE VALORES
                  </div>
                </div>

                <div className="fg">
                  <label className="flabel">🔧 MÃO DE OBRA</label>
                  <CurrencyInput value={f.labor_value} onChange={setLabor} />
                </div>

                <div className="fg">
                  <label className="flabel">🪛 MATERIAIS</label>
                  <CurrencyInput value={f.materials_value} onChange={setMaterials} />
                </div>

                <div className="fg full">
                  <label className="flabel">
                    VALOR TOTAL
                    {(Number(f.labor_value) > 0 || Number(f.materials_value) > 0) && (
                      <span style={{ marginLeft: '.5rem', fontSize: '.68rem', color: 'var(--muted)', fontWeight: 400 }}>
                        (calculado automaticamente — edite se necessário)
                      </span>
                    )}
                  </label>
                  <CurrencyInput value={f.amount} onChange={v => setF(p => ({ ...p, amount: v }))} />
                </div>

                {/* Prévia dos valores */}
                {Number(f.amount) > 0 && (
                  <div className="fg full">
                    <div style={{
                      padding: '.65rem 1rem', background: 'var(--green)0d',
                      border: '1px solid var(--green)33', borderRadius: 8,
                      display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {Number(f.labor_value) > 0 && (
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '.68rem', color: 'var(--muted)', marginBottom: '.15rem' }}>Mão de Obra</div>
                          <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--blue)' }}>{fmtMoney(f.labor_value)}</div>
                        </div>
                      )}
                      {Number(f.materials_value) > 0 && (
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '.68rem', color: 'var(--muted)', marginBottom: '.15rem' }}>Materiais</div>
                          <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--warn)' }}>{fmtMoney(f.materials_value)}</div>
                        </div>
                      )}
                      <div style={{ textAlign: 'center', paddingLeft: Number(f.labor_value) > 0 || Number(f.materials_value) > 0 ? '.75rem' : 0, borderLeft: Number(f.labor_value) > 0 || Number(f.materials_value) > 0 ? '1px solid var(--border)' : 'none' }}>
                        <div style={{ fontSize: '.68rem', color: 'var(--muted)', marginBottom: '.15rem' }}>Total</div>
                        <div style={{ fontFamily: 'var(--mono)', fontWeight: 800, fontSize: '1.05rem', color: 'var(--green)' }}>{fmtMoney(f.amount)}</div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="fg">
                  <label className="flabel">PRAZO</label>
                  <input className="finput" type="date" value={f.due_date}
                    onChange={e => setF(p => ({ ...p, due_date: e.target.value }))} />
                </div>

                <div className="fg">
                  <label className="flabel">STATUS</label>
                  <select className="finput" value={f.status}
                    onChange={e => setF(p => ({ ...p, status: e.target.value }))}>
                    {Object.entries(STATUS_CFG).map(([k, v]) => (
                      <option key={k} value={k}>{v.icon} {v.label}</option>
                    ))}
                  </select>
                </div>

                <div className="fg full">
                  <label className="flabel">DESCRIÇÃO / ESCOPO</label>
                  <textarea className="finput" rows={3} value={f.description}
                    onChange={e => setF(p => ({ ...p, description: e.target.value }))}
                    placeholder="Descreva o escopo do serviço, materiais inclusos, condições..."
                    style={{ resize: 'vertical' }} />
                </div>

              </div>
            </div>

            <div className="mfoot">
              <button className="btn-sec" onClick={() => setModal(false)}>Cancelar</button>
              {/* Salvar + Aprovar → OS direto do modal */}
              {!editing && (
                <button className="btn-sec" style={{ color: 'var(--green)', borderColor: 'var(--green)33' }}
                  onClick={async () => {
                    if (!f.title.trim()) return showToast('Título obrigatório', 'err')
                    setSaving(true)
                    const company_id = await getCompanyId()
                    const { data: bud, error } = await supabase.from('budgets').insert({
                      title:           f.title,
                      description:     f.description,
                      client_id:       f.client_id || null,
                      amount:          Number(f.amount) || 0,
                      labor_value:     Number(f.labor_value) || 0,
                      materials_value: Number(f.materials_value) || 0,
                      status:          'pendente',
                      due_date:        f.due_date || null,
                      company_id,
                    }).select('*, clients(name)').single()
                    if (error) { showToast('Erro: ' + error.message, 'err'); setSaving(false); return }
                    setSaving(false); setModal(false)
                    load()
                    approveAndCreateOS(bud)
                  }}
                  disabled={saving}>
                  ✅ Salvar e Aprovar → OS
                </button>
              )}
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Salvando…' : '✓ Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
