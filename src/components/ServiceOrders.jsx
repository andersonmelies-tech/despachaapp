import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const STATUS_CFG = {
  aberta:    { label: 'Aberta',     color: 'var(--blue)',   next: 'andamento' },
  andamento: { label: 'Andamento',  color: 'var(--warn)',   next: 'concluida' },
  concluida: { label: 'Concluída',  color: 'var(--green)',  next: 'faturada' },
  faturada:  { label: 'Faturada',   color: 'var(--purple)', next: null },
  cancelada: { label: 'Cancelada',  color: 'var(--red)',    next: null },
}

const NFSE_CFG = {
  nao_emitida: { label: 'Não emitida', color: 'var(--muted)' },
  emitindo:    { label: 'Emitindo…',   color: 'var(--warn)' },
  emitida:     { label: 'NFS-e OK',    color: 'var(--green)' },
  erro:        { label: 'Erro NFS-e',  color: 'var(--red)' },
}

function fmt(v) { return v ? new Date(v + 'T00:00:00').toLocaleDateString('pt-BR') : '—' }
function fmtMoney(v) {
  return v != null ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'
}

const EMPTY_FORM = {
  title: '', description: '', client_id: '', collaborator_id: '',
  status: 'aberta', due_date: '',
  total_value: '', labor_value: '', materials_value: '',
}

export default function ServiceOrders({ showToast, session }) {
  const [orders,   setOrders]   = useState([])
  const [clients,  setClients]  = useState([])
  const [collabs,  setCollabs]  = useState([])
  const [modal,    setModal]    = useState(false)
  const [editing,  setEditing]  = useState(null)
  const [saving,   setSaving]   = useState(false)
  const [emitting, setEmitting] = useState(null)
  const [f, setF] = useState(EMPTY_FORM)

  async function load() {
    const [or, cl, co] = await Promise.all([
      supabase.from('service_orders')
        .select('*, clients(name), providers(name)')
        .order('created_at', { ascending: false }),
      supabase.from('clients').select('id, name').eq('active', true).order('name'),
      supabase.from('providers').select('id, name').eq('active', 1).order('name'),
    ])
    setOrders(or.data || [])
    setClients(cl.data || [])
    setCollabs(co.data || [])
  }

  useEffect(() => { load() }, [])

  function openNew() {
    setEditing(null)
    setF(EMPTY_FORM)
    setModal(true)
  }

  function openEdit(o) {
    setEditing(o)
    setF({
      title:           o.title,
      description:     o.description || '',
      client_id:       o.client_id || '',
      collaborator_id: o.collaborator_id || '',
      status:          o.status,
      due_date:        o.due_date || '',
      total_value:     o.total_value || '',
      labor_value:     o.labor_value || '',
      materials_value: o.materials_value || '',
    })
    setModal(true)
  }

  async function save() {
    if (!f.title.trim()) return showToast('Título obrigatório', 'err')
    setSaving(true)
    const payload = {
      title:           f.title,
      description:     f.description,
      client_id:       f.client_id || null,
      collaborator_id: f.collaborator_id ? Number(f.collaborator_id) : null,
      status:          f.status,
      due_date:        f.due_date || null,
      total_value:     Number(f.total_value) || 0,
      labor_value:     Number(f.labor_value) || 0,
      materials_value: Number(f.materials_value) || 0,
    }
    if (f.status === 'concluida' && !editing?.completed_at) {
      payload.completed_at = new Date().toISOString()
    }
    if (editing) {
      await supabase.from('service_orders').update(payload).eq('id', editing.id)
    } else {
      await supabase.from('service_orders').insert(payload)
    }
    showToast(editing ? 'OS atualizada ✓' : 'OS criada ✓')
    setSaving(false)
    setModal(false)
    load()
  }

  async function advanceStatus(o) {
    const next = STATUS_CFG[o.status]?.next
    if (!next) return
    const update = { status: next }
    if (next === 'concluida') update.completed_at = new Date().toISOString()
    await supabase.from('service_orders').update(update).eq('id', o.id)
    showToast(`OS ${o.os_number} → ${STATUS_CFG[next].label} ✓`)
    load()
  }

  async function emitNFSe(o) {
    if (!session?.access_token) return
    setEmitting(o.id)
    try {
      const res = await fetch('/api/nfse/emit', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ service_order_id: o.id }),
      })
      const data = await res.json()
      if (data.ok) {
        showToast(`NFS-e ${data.nfse_number ? '#' + data.nfse_number : ''} emitida ✓`)
      } else {
        showToast('Erro NFS-e: ' + (data.error || 'Desconhecido'), 'err')
      }
    } catch (e) {
      showToast('Erro de conexão', 'err')
    }
    setEmitting(null)
    load()
  }

  async function del(o) {
    if (!confirm(`Cancelar a OS ${o.os_number}?`)) return
    await supabase.from('service_orders').update({ status: 'cancelada' }).eq('id', o.id)
    showToast(`OS ${o.os_number} cancelada`)
    load()
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '.75rem' }}>
        <h2 style={{ fontFamily: 'var(--mono)', fontSize: '1rem', color: 'var(--blue)', letterSpacing: '.04em' }}>📋 ORDENS DE SERVIÇO</h2>
        <button className="btn-primary" onClick={openNew}>+ Nova OS</button>
      </div>

      {/* Tabela */}
      <div className="cfg-card" style={{ overflowX: 'auto' }}>
        {orders.length === 0 ? (
          <div className="empty">Nenhuma OS criada</div>
        ) : (
          <table className="rep-table">
            <thead>
              <tr>
                <th>Nº OS</th>
                <th>Título</th>
                <th>Cliente</th>
                <th>Colaborador</th>
                <th>Valor</th>
                <th>Prazo</th>
                <th>Status</th>
                <th>NFS-e</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => {
                const sc = STATUS_CFG[o.status] || STATUS_CFG.aberta
                const nc = NFSE_CFG[o.nfse_status] || NFSE_CFG.nao_emitida
                const canAdvance  = !!sc.next
                const canNFSe     = o.status === 'concluida' || o.status === 'faturada'
                const nfseEmitida = o.nfse_status === 'emitida'
                return (
                  <tr key={o.id}>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--blue)', whiteSpace: 'nowrap' }}>{o.os_number}</td>
                    <td style={{ fontWeight: 600, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.title}>{o.title}</td>
                    <td style={{ color: 'var(--muted)', fontSize: '.85rem' }}>{o.clients?.name || '—'}</td>
                    <td style={{ color: 'var(--muted)', fontSize: '.85rem' }}>{o.providers?.name || '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--green)', whiteSpace: 'nowrap' }}>{fmtMoney(o.total_value)}</td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--muted)', fontSize: '.8rem' }}>{fmt(o.due_date)}</td>
                    <td>
                      <span style={{ background: sc.color + '22', color: sc.color, padding: '.2rem .55rem', borderRadius: 6, fontSize: '.72rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {sc.label}
                      </span>
                    </td>
                    <td>
                      {nfseEmitida && o.nfse_url ? (
                        <a href={o.nfse_url} target="_blank" rel="noopener noreferrer"
                          style={{ color: 'var(--green)', fontSize: '.75rem', textDecoration: 'underline' }}>
                          #{o.nfse_number}
                        </a>
                      ) : (
                        <span style={{ color: nc.color, fontSize: '.72rem', fontWeight: 600 }}>{nc.label}</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '.3rem', alignItems: 'center', flexWrap: 'nowrap' }}>
                        <button className="abtn" onClick={() => openEdit(o)} title="Editar">✏</button>
                        {canAdvance && (
                          <button className="abtn" style={{ color: sc.color, fontSize: '.68rem', padding: '.2rem .45rem', whiteSpace: 'nowrap' }}
                            onClick={() => advanceStatus(o)} title={`Avançar para ${STATUS_CFG[sc.next]?.label}`}>
                            → {STATUS_CFG[sc.next]?.label}
                          </button>
                        )}
                        {canNFSe && !nfseEmitida && (
                          <button className="abtn" style={{ color: 'var(--purple)', fontSize: '.68rem', padding: '.2rem .45rem' }}
                            onClick={() => emitNFSe(o)} disabled={emitting === o.id}>
                            {emitting === o.id ? '⏳' : '🧾 NFS-e'}
                          </button>
                        )}
                        {o.status === 'aberta' && (
                          <button className="abtn r" onClick={() => del(o)} title="Cancelar OS">✕</button>
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
          <div className="modal" style={{ maxWidth: 640 }}>
            <div className="mhead">
              <span className="mtitle">{editing ? `EDITAR ${editing.os_number}` : 'NOVA ORDEM DE SERVIÇO'}</span>
              <button className="mclose" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="mbody">
              <div className="fgrid">
                {/* Título */}
                <div className="fg full">
                  <label className="flabel">TÍTULO DA OS *</label>
                  <input className="finput" value={f.title} onChange={e => setF(p => ({ ...p, title: e.target.value }))}
                    placeholder="Ex: Manutenção elétrica — Sala 3" autoFocus />
                </div>

                {/* Cliente */}
                <div className="fg">
                  <label className="flabel">CLIENTE</label>
                  <select className="finput" value={f.client_id} onChange={e => setF(p => ({ ...p, client_id: e.target.value }))}>
                    <option value="">Selecione…</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                {/* Colaborador */}
                <div className="fg">
                  <label className="flabel">COLABORADOR RESPONSÁVEL</label>
                  <select className="finput" value={f.collaborator_id} onChange={e => setF(p => ({ ...p, collaborator_id: e.target.value }))}>
                    <option value="">Selecione…</option>
                    {collabs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                {/* Status */}
                <div className="fg">
                  <label className="flabel">STATUS</label>
                  <select className="finput" value={f.status} onChange={e => setF(p => ({ ...p, status: e.target.value }))}>
                    {Object.entries(STATUS_CFG).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>

                {/* Prazo */}
                <div className="fg">
                  <label className="flabel">PRAZO</label>
                  <input className="finput" type="date" value={f.due_date}
                    onChange={e => setF(p => ({ ...p, due_date: e.target.value }))} />
                </div>

                {/* Separador valores */}
                <div className="fg full">
                  <div style={{ borderTop: '1px solid var(--border)', margin: '.25rem 0 .75rem', opacity: .4 }} />
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)', letterSpacing: '.08em', fontFamily: 'var(--mono)', marginBottom: '.5rem' }}>VALORES (R$)</div>
                </div>

                {/* Valor total */}
                <div className="fg">
                  <label className="flabel">VALOR TOTAL</label>
                  <input className="finput" type="number" min="0" step="0.01"
                    value={f.total_value} onChange={e => setF(p => ({ ...p, total_value: e.target.value }))}
                    placeholder="0,00" />
                </div>

                {/* Mão de obra */}
                <div className="fg">
                  <label className="flabel">MÃO DE OBRA</label>
                  <input className="finput" type="number" min="0" step="0.01"
                    value={f.labor_value} onChange={e => setF(p => ({ ...p, labor_value: e.target.value }))}
                    placeholder="0,00" />
                </div>

                {/* Materiais */}
                <div className="fg">
                  <label className="flabel">MATERIAIS</label>
                  <input className="finput" type="number" min="0" step="0.01"
                    value={f.materials_value} onChange={e => setF(p => ({ ...p, materials_value: e.target.value }))}
                    placeholder="0,00" />
                </div>

                {/* Descrição */}
                <div className="fg full">
                  <label className="flabel">DESCRIÇÃO / OBSERVAÇÕES</label>
                  <textarea className="finput" rows={3} value={f.description}
                    onChange={e => setF(p => ({ ...p, description: e.target.value }))}
                    placeholder="Detalhes do serviço, materiais usados, observações…"
                    style={{ resize: 'vertical' }} />
                </div>
              </div>
            </div>
            <div className="mfoot">
              <button className="btn-sec" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Salvando…' : '✓ Salvar OS'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
