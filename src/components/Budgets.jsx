import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const STATUS_CFG = {
  pendente:   { label: 'Pendente',   color: 'var(--warn)' },
  aprovado:   { label: 'Aprovado',   color: 'var(--green)' },
  recusado:   { label: 'Recusado',   color: 'var(--red)' },
  convertido: { label: 'Convertido', color: 'var(--purple)' },
}

function fmt(v) { return v ? new Date(v).toLocaleDateString('pt-BR') : '—' }
function fmtMoney(v) { return v != null ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—' }

export default function Budgets({ showToast }) {
  const [budgets,     setBudgets]     = useState([])
  const [clients,     setClients]     = useState([])
  const [modal,       setModal]       = useState(false)
  const [editing,     setEditing]     = useState(null)
  const [saving,      setSaving]      = useState(false)
  const [converting,  setConverting]  = useState(null)
  const [convertingOS, setConvertingOS] = useState(null)
  const [f, setF] = useState({ title: '', description: '', client_id: '', amount: '', status: 'pendente', due_date: '' })

  async function load() {
    const [br, cr] = await Promise.all([
      supabase.from('budgets').select('*, clients(name)').order('created_at', { ascending: false }),
      supabase.from('clients').select('id, name').eq('active', true).order('name'),
    ])
    setBudgets(br.data || [])
    setClients(cr.data || [])
  }
  useEffect(() => { load() }, [])

  function openNew() { setEditing(null); setF({ title: '', description: '', client_id: '', amount: '', status: 'pendente', due_date: '' }); setModal(true) }
  function openEdit(b) { setEditing(b); setF({ title: b.title, description: b.description || '', client_id: b.client_id || '', amount: b.amount || '', status: b.status, due_date: b.due_date || '' }); setModal(true) }

  async function save() {
    if (!f.title.trim()) return showToast('Título obrigatório', 'err')
    setSaving(true)
    const payload = { title: f.title, description: f.description, client_id: f.client_id || null, amount: Number(f.amount) || 0, status: f.status, due_date: f.due_date || null }
    if (editing) await supabase.from('budgets').update(payload).eq('id', editing.id)
    else await supabase.from('budgets').insert(payload)
    showToast(editing ? 'Orçamento atualizado ✓' : 'Orçamento criado ✓')
    setSaving(false); setModal(false); load()
  }

  async function convertToTask(b) {
    setConverting(b.id)
    const { data, error } = await supabase.from('tasks').insert({
      title: b.title,
      description: b.description || '',
      requester: b.clients?.name || 'Cliente',
      client_name: b.clients?.name || '',
      urgency: 'media',
      status: 'pendente',
    }).select().single()
    if (error) { showToast('Erro ao converter', 'err'); setConverting(null); return }
    await supabase.from('budgets').update({ status: 'convertido', task_id: data.id }).eq('id', b.id)
    showToast('Orçamento convertido em tarefa ✓ 🎉')
    setConverting(null); load()
  }

  async function convertToOS(b) {
    setConvertingOS(b.id)
    const { data, error } = await supabase.from('service_orders').insert({
      title:       b.title,
      description: b.description || '',
      client_id:   b.client_id || null,
      total_value: Number(b.amount) || 0,
      status:      'aberta',
      budget_id:   b.id,
    }).select().single()
    if (error) { showToast('Erro ao criar OS: ' + error.message, 'err'); setConvertingOS(null); return }
    await supabase.from('budgets').update({ status: 'convertido', service_order_id: data.id }).eq('id', b.id)
    showToast(`Orçamento convertido em OS ${data.os_number} ✓ 🎉`)
    setConvertingOS(null); load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '.75rem' }}>
        <h2 style={{ fontFamily: 'var(--mono)', fontSize: '1rem', color: 'var(--green)', letterSpacing: '.04em' }}>💰 ORÇAMENTOS</h2>
        <button className="btn-primary" onClick={openNew}>+ Novo Orçamento</button>
      </div>

      <div className="cfg-card" style={{ overflowX: 'auto' }}>
        {budgets.length === 0 ? <div className="empty">Nenhum orçamento cadastrado</div> : (
          <table className="rep-table">
            <thead><tr>
              <th>Título</th><th>Cliente</th><th>Valor</th><th>Prazo</th><th>Status</th><th>Ações</th>
            </tr></thead>
            <tbody>
              {budgets.map(b => {
                const sc = STATUS_CFG[b.status] || STATUS_CFG.pendente
                return (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600 }}>{b.title}</td>
                    <td style={{ color: 'var(--muted)' }}>{b.clients?.name || '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmtMoney(b.amount)}</td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{fmt(b.due_date)}</td>
                    <td><span style={{ background: sc.color + '22', color: sc.color, padding: '.2rem .6rem', borderRadius: 6, fontSize: '.75rem', fontWeight: 600 }}>{sc.label}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: '.35rem' }}>
                        <button className="abtn" onClick={() => openEdit(b)}>✏</button>
                        {b.status === 'aprovado' && (
                          <>
                            <button className="abtn" style={{ color: 'var(--green)', fontSize: '.7rem', padding: '.2rem .5rem' }}
                              onClick={() => convertToTask(b)} disabled={converting === b.id}>
                              {converting === b.id ? '⏳' : '→ Tarefa'}
                            </button>
                            <button className="abtn" style={{ color: 'var(--blue)', fontSize: '.7rem', padding: '.2rem .5rem' }}
                              onClick={() => convertToOS(b)} disabled={convertingOS === b.id}>
                              {convertingOS === b.id ? '⏳' : '→ OS'}
                            </button>
                          </>
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

      {modal && (
        <div className="overlay open" onClick={e => e.target.className === 'overlay open' && setModal(false)}>
          <div className="modal">
            <div className="mhead">
              <span className="mtitle">{editing ? 'EDITAR ORÇAMENTO' : 'NOVO ORÇAMENTO'}</span>
              <button className="mclose" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="mbody">
              <div className="fgrid">
                <div className="fg full"><label className="flabel">TÍTULO *</label>
                  <input className="finput" value={f.title} onChange={e => setF(p => ({...p, title: e.target.value}))} placeholder="Descrição do serviço/produto" /></div>
                <div className="fg"><label className="flabel">CLIENTE</label>
                  <select className="finput" value={f.client_id} onChange={e => setF(p => ({...p, client_id: e.target.value}))}>
                    <option value="">Selecione...</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></div>
                <div className="fg"><label className="flabel">VALOR (R$)</label>
                  <input className="finput" type="number" min="0" step="0.01" value={f.amount} onChange={e => setF(p => ({...p, amount: e.target.value}))} placeholder="0,00" /></div>
                <div className="fg"><label className="flabel">PRAZO</label>
                  <input className="finput" type="date" value={f.due_date} onChange={e => setF(p => ({...p, due_date: e.target.value}))} /></div>
                <div className="fg"><label className="flabel">STATUS</label>
                  <select className="finput" value={f.status} onChange={e => setF(p => ({...p, status: e.target.value}))}>
                    {Object.entries(STATUS_CFG).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select></div>
                <div className="fg full"><label className="flabel">DESCRIÇÃO</label>
                  <textarea className="finput" rows={3} value={f.description} onChange={e => setF(p => ({...p, description: e.target.value}))} placeholder="Detalhes do orçamento..." style={{ resize: 'vertical' }} /></div>
              </div>
            </div>
            <div className="mfoot">
              <button className="btn-sec" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : '✓ Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
