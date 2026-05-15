import { useState, useEffect } from 'react'
import { supabase, getCompanyId } from '../lib/supabase.js'

export default function Clients({ showToast }) {
  const [clients, setClients] = useState([])
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [f, setF] = useState({ name: '', address: '', phone: '', email: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  async function load() {
    const { data } = await supabase.from('clients').select('*').eq('active', true).order('name')
    setClients(data || [])
  }
  useEffect(() => { load() }, [])

  function openNew() { setEditing(null); setF({ name: '', address: '', phone: '', email: '', notes: '' }); setModal(true) }
  function openEdit(c) { setEditing(c); setF({ name: c.name, address: c.address || '', phone: c.phone || '', email: c.email || '', notes: c.notes || '' }); setModal(true) }

  async function save() {
    if (!f.name.trim()) return showToast('Nome obrigatório', 'err')
    setSaving(true)
    const payload = { name: f.name, address: f.address, phone: f.phone, email: f.email, notes: f.notes }
    if (editing) {
      await supabase.from('clients').update(payload).eq('id', editing.id)
    } else {
      payload.company_id = await getCompanyId()
      const { error } = await supabase.from('clients').insert(payload)
      if (error) { showToast('Erro: ' + error.message, 'err'); setSaving(false); return }
    }
    showToast(editing ? 'Cliente atualizado ✓' : 'Cliente criado ✓')
    setSaving(false); setModal(false); load()
  }

  async function del(id) {
    if (!confirm('Arquivar este cliente?')) return
    await supabase.from('clients').update({ active: false }).eq('id', id)
    showToast('Cliente arquivado'); load()
  }

  const filtered = clients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || (c.email || '').toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '.75rem', flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: 'var(--mono)', fontSize: '1rem', color: 'var(--blue)', letterSpacing: '.04em' }}>👥 CLIENTES</h2>
        <div style={{ display: 'flex', gap: '.65rem', flex: 1, maxWidth: 400 }}>
          <input className="finput" placeholder="Buscar cliente..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1 }} />
          <button className="btn-primary" onClick={openNew}>+ Novo Cliente</button>
        </div>
      </div>

      <div className="cfg-card">
        {filtered.length === 0 ? (
          <div className="empty">Nenhum cliente cadastrado</div>
        ) : filtered.map(c => (
          <div key={c.id} className="provider-row">
            <div className="provider-avatar" style={{ background: 'linear-gradient(135deg, var(--blue), var(--purple))' }}>
              {c.name.charAt(0).toUpperCase()}
            </div>
            <div className="provider-info" style={{ flex: 1 }}>
              <div className="provider-name">{c.name}</div>
              <div className="provider-meta">
                {[c.phone, c.email, c.address].filter(Boolean).join(' · ') || 'Sem informações adicionais'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '.35rem' }}>
              <button className="abtn" onClick={() => openEdit(c)}>✏</button>
              <button className="abtn r" onClick={() => del(c.id)}>🗑</button>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="overlay open" onClick={e => e.target.className === 'overlay open' && setModal(false)}>
          <div className="modal">
            <div className="mhead">
              <span className="mtitle">{editing ? 'EDITAR CLIENTE' : 'NOVO CLIENTE'}</span>
              <button className="mclose" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="mbody">
              <div className="fgrid">
                <div className="fg full"><label className="flabel">NOME *</label>
                  <input className="finput" value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} placeholder="Nome completo ou razão social" /></div>
                <div className="fg"><label className="flabel">TELEFONE</label>
                  <input className="finput" value={f.phone} onChange={e => setF(p => ({ ...p, phone: e.target.value }))} placeholder="(11) 99999-9999" /></div>
                <div className="fg"><label className="flabel">E-MAIL</label>
                  <input className="finput" type="email" value={f.email} onChange={e => setF(p => ({ ...p, email: e.target.value }))} placeholder="email@cliente.com" /></div>
                <div className="fg full"><label className="flabel">ENDEREÇO</label>
                  <input className="finput" value={f.address} onChange={e => setF(p => ({ ...p, address: e.target.value }))} placeholder="Rua, número, bairro, cidade" /></div>
                <div className="fg full"><label className="flabel">OBSERVAÇÕES</label>
                  <textarea className="finput" rows={3} value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} placeholder="Notas internas sobre o cliente..." style={{ resize: 'vertical' }} /></div>
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
