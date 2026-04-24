import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'

function fmtMoney(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmt(v) { return v ? new Date(v + 'T12:00:00').toLocaleDateString('pt-BR') : '—' }

export default function CashFlow({ showToast }) {
  const [entries,  setEntries]  = useState([])
  const [clients,  setClients]  = useState([])
  const [collaborators, setCollaborators] = useState([])
  const [modal,    setModal]    = useState(false)
  const [editing,  setEditing]  = useState(null)
  const [saving,   setSaving]   = useState(false)
  const [filter,   setFilter]   = useState('all') // all | receita | despesa
  const [f, setF] = useState({ type: 'receita', category: '', description: '', amount: '', date: new Date().toISOString().slice(0,10), client_id: '', collaborator_id: '', paid: false })

  async function load() {
    const [er, cr, pr] = await Promise.all([
      supabase.from('cash_flow').select('*, clients(name), providers(name)').order('date', { ascending: false }),
      supabase.from('clients').select('id,name').eq('active', true).order('name'),
      supabase.from('providers').select('id,name').eq('active', 1).order('name'),
    ])
    setEntries(er.data || [])
    setClients(cr.data || [])
    setCollaborators(pr.data || [])
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => filter === 'all' ? entries : entries.filter(e => e.type === filter), [entries, filter])

  const totals = useMemo(() => ({
    receitas: entries.filter(e => e.type === 'receita').reduce((a, e) => a + Number(e.amount), 0),
    despesas: entries.filter(e => e.type === 'despesa').reduce((a, e) => a + Number(e.amount), 0),
  }), [entries])
  const saldo = totals.receitas - totals.despesas

  function openNew() { setEditing(null); setF({ type: 'receita', category: '', description: '', amount: '', date: new Date().toISOString().slice(0,10), client_id: '', collaborator_id: '', paid: false }); setModal(true) }
  function openEdit(e) { setEditing(e); setF({ type: e.type, category: e.category || '', description: e.description, amount: e.amount, date: e.date, client_id: e.client_id || '', collaborator_id: e.collaborator_id || '', paid: e.paid }); setModal(true) }

  async function save() {
    if (!f.description.trim() || !f.amount) return showToast('Preencha descrição e valor', 'err')
    setSaving(true)
    const payload = { type: f.type, category: f.category, description: f.description, amount: Number(f.amount), date: f.date, client_id: f.client_id || null, collaborator_id: f.collaborator_id || null, paid: f.paid }
    if (editing) await supabase.from('cash_flow').update(payload).eq('id', editing.id)
    else await supabase.from('cash_flow').insert(payload)
    showToast(editing ? 'Lançamento atualizado ✓' : 'Lançamento criado ✓')
    setSaving(false); setModal(false); load()
  }

  async function del(id) {
    if (!confirm('Excluir este lançamento?')) return
    await supabase.from('cash_flow').delete().eq('id', id)
    showToast('Lançamento excluído'); load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '.75rem' }}>
        <h2 style={{ fontFamily: 'var(--mono)', fontSize: '1rem', color: 'var(--green)', letterSpacing: '.04em' }}>💳 CONTROLE DE CAIXA</h2>
        <button className="btn-primary" onClick={openNew}>+ Novo Lançamento</button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.75rem', marginBottom: '1rem' }}>
        {[
          { label: 'Receitas', val: totals.receitas, color: 'var(--green)' },
          { label: 'Despesas', val: totals.despesas, color: 'var(--red)' },
          { label: 'Saldo',    val: saldo,           color: saldo >= 0 ? 'var(--green)' : 'var(--red)' },
        ].map(k => (
          <div key={k.label} className="cfg-card" style={{ padding: '1rem', textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: k.color, fontFamily: 'var(--mono)' }}>{fmtMoney(k.val)}</div>
            <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: '.25rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="stab-bar" style={{ marginBottom: '1rem' }}>
        {[['all','Todos'],['receita','Receitas'],['despesa','Despesas']].map(([id, label]) => (
          <button key={id} className={`stab${filter === id ? ' active' : ''}`} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>

      <div className="cfg-card" style={{ overflowX: 'auto' }}>
        {filtered.length === 0 ? <div className="empty">Nenhum lançamento</div> : (
          <table className="rep-table">
            <thead><tr><th>Data</th><th>Descrição</th><th>Cliente/Colaborador</th><th>Valor</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id}>
                  <td style={{ fontFamily: 'var(--mono)', color: 'var(--muted)', fontSize: '.8rem' }}>{fmt(e.date)}</td>
                  <td style={{ fontWeight: 600 }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: e.type === 'receita' ? 'var(--green)' : 'var(--red)', marginRight: '.5rem' }} />
                    {e.description}
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: '.82rem' }}>{e.clients?.name || e.providers?.name || '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: e.type === 'receita' ? 'var(--green)' : 'var(--red)' }}>
                    {e.type === 'receita' ? '+' : '-'}{fmtMoney(e.amount)}
                  </td>
                  <td>
                    <span style={{ fontSize: '.72rem', padding: '.2rem .5rem', borderRadius: 6, background: e.paid ? '#10B98122' : '#F9731622', color: e.paid ? 'var(--green)' : 'var(--warn)' }}>
                      {e.paid ? '✓ Pago' : '⏳ Pendente'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '.35rem' }}>
                      <button className="abtn" onClick={() => openEdit(e)}>✏</button>
                      <button className="abtn r" onClick={() => del(e.id)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <div className="overlay open" onClick={ev => ev.target.className === 'overlay open' && setModal(false)}>
          <div className="modal">
            <div className="mhead">
              <span className="mtitle">{editing ? 'EDITAR LANÇAMENTO' : 'NOVO LANÇAMENTO'}</span>
              <button className="mclose" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="mbody">
              <div className="fgrid">
                <div className="fg"><label className="flabel">TIPO</label>
                  <select className="finput" value={f.type} onChange={e => setF(p => ({...p, type: e.target.value}))}>
                    <option value="receita">💚 Receita</option>
                    <option value="despesa">🔴 Despesa</option>
                  </select></div>
                <div className="fg"><label className="flabel">DATA</label>
                  <input className="finput" type="date" value={f.date} onChange={e => setF(p => ({...p, date: e.target.value}))} /></div>
                <div className="fg full"><label className="flabel">DESCRIÇÃO *</label>
                  <input className="finput" value={f.description} onChange={e => setF(p => ({...p, description: e.target.value}))} placeholder="Ex: Pagamento OS #123" /></div>
                <div className="fg"><label className="flabel">VALOR (R$) *</label>
                  <input className="finput" type="number" min="0" step="0.01" value={f.amount} onChange={e => setF(p => ({...p, amount: e.target.value}))} placeholder="0,00" /></div>
                <div className="fg"><label className="flabel">CATEGORIA</label>
                  <input className="finput" value={f.category} onChange={e => setF(p => ({...p, category: e.target.value}))} placeholder="Ex: Serviço, Material..." /></div>
                <div className="fg"><label className="flabel">CLIENTE</label>
                  <select className="finput" value={f.client_id} onChange={e => setF(p => ({...p, client_id: e.target.value}))}>
                    <option value="">Nenhum</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></div>
                <div className="fg"><label className="flabel">COLABORADOR</label>
                  <select className="finput" value={f.collaborator_id} onChange={e => setF(p => ({...p, collaborator_id: e.target.value}))}>
                    <option value="">Nenhum</option>
                    {collaborators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></div>
                <div className="fg full" style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                  <input type="checkbox" id="paid-cb" checked={f.paid} onChange={e => setF(p => ({...p, paid: e.target.checked}))} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                  <label htmlFor="paid-cb" style={{ color: 'var(--text)', cursor: 'pointer', fontSize: '.88rem' }}>Marcar como pago/recebido</label>
                </div>
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
