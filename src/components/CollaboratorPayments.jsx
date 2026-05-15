import { useState, useEffect, useMemo } from 'react'
import { supabase, getCompanyId } from '../lib/supabase.js'

function fmtMoney(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtDate(v) {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

// ── Cartão de resumo por colaborador ───────────────────────────────────────
function CollabSummaryCard({ name, pending, total, onClick }) {
  return (
    <div className="cfg-card" style={{ padding: '1rem', cursor: 'pointer', borderColor: pending > 0 ? 'var(--warn)44' : 'var(--border)' }}
      onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '.95rem' }}>🔧 {name}</div>
          <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.2rem' }}>
            {pending > 0
              ? <span style={{ color: 'var(--warn)' }}>⏳ {pending} {pending === 1 ? 'serviço pendente' : 'serviços pendentes'}</span>
              : <span style={{ color: 'var(--green)' }}>✓ Em dia</span>
            }
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--mono)', fontWeight: 800, fontSize: '1.1rem', color: pending > 0 ? 'var(--warn)' : 'var(--muted)' }}>
            {fmtMoney(total)}
          </div>
          <div style={{ fontSize: '.7rem', color: 'var(--muted)', marginTop: '.15rem' }}>a pagar</div>
        </div>
      </div>
    </div>
  )
}

export default function CollaboratorPayments({ showToast }) {
  const [collabs,    setCollabs]    = useState([])   // terceirizados
  const [osItems,    setOsItems]    = useState([])   // OS pendentes
  const [taskItems,  setTaskItems]  = useState([])   // Tarefas pendentes
  const [selectedId, setSelectedId] = useState(null) // colaborador selecionado
  const [paying,     setPaying]     = useState(null) // id do item sendo pago
  const [tab,        setTab]        = useState('pendente') // pendente | pago
  const [history,    setHistory]    = useState([])   // itens pagos

  // ── Carrega dados ─────────────────────────────────────────────────────────
  async function load() {
    const [pr, osr, tkr] = await Promise.all([
      // Colaboradores terceirizados ativos
      supabase.from('providers')
        .select('id, name, payment_rate, payment_notes')
        .eq('is_third_party', true)
        .eq('active', 1)
        .order('name'),

      // OS concluídas/faturadas com terceirizados — não pagas
      supabase.from('service_orders')
        .select('id, os_number, title, total_value, labor_value, collaborator_paid, collaborator_paid_at, collaborator_paid_value, status, completed_at, collaborator_id, providers(id, name, payment_rate)')
        .in('status', ['concluida', 'faturada'])
        .eq('collaborator_paid', false)
        .not('collaborator_id', 'is', null),

      // Tarefas concluídas com terceirizados — não pagas
      supabase.from('tasks')
        .select('id, title, status, collaborator_paid, collaborator_paid_at, collaborator_paid_value, provider_id, providers(id, name, payment_rate, is_third_party)')
        .eq('status', 'concluida')
        .eq('collaborator_paid', false)
        .not('provider_id', 'is', null),
    ])

    const terceirizadoIds = new Set((pr.data || []).map(p => p.id))

    // Filtra OSs que realmente são de terceirizados
    const filteredOS = (osr.data || []).filter(o => o.providers && terceirizadoIds.has(o.providers.id))
    // Filtra tarefas que realmente são de terceirizados
    const filteredTasks = (tkr.data || []).filter(t => t.providers?.is_third_party)

    setCollabs(pr.data || [])
    setOsItems(filteredOS)
    setTaskItems(filteredTasks)
  }

  async function loadHistory() {
    const [osr, tkr] = await Promise.all([
      supabase.from('service_orders')
        .select('id, os_number, title, collaborator_paid_at, collaborator_paid_value, collaborator_id, providers(name)')
        .in('status', ['concluida', 'faturada'])
        .eq('collaborator_paid', true)
        .not('collaborator_id', 'is', null)
        .order('collaborator_paid_at', { ascending: false })
        .limit(100),

      supabase.from('tasks')
        .select('id, title, collaborator_paid_at, collaborator_paid_value, provider_id, providers(name, is_third_party)')
        .eq('status', 'concluida')
        .eq('collaborator_paid', true)
        .not('provider_id', 'is', null)
        .order('collaborator_paid_at', { ascending: false })
        .limit(100),
    ])

    const paid = [
      ...(osr.data || []).map(o => ({ ...o, kind: 'OS',     label: `${o.os_number} — ${o.title}`, collab: o.providers?.name })),
      ...(tkr.data || []).filter(t => t.providers?.is_third_party).map(t => ({ ...t, kind: 'Tarefa', label: t.title, collab: t.providers?.name })),
    ].sort((a, b) => new Date(b.collaborator_paid_at) - new Date(a.collaborator_paid_at))

    setHistory(paid)
  }

  useEffect(() => { load() }, [])
  useEffect(() => { if (tab === 'pago') loadHistory() }, [tab])

  // ── Agrupa pendências por colaborador ─────────────────────────────────────
  const pendingByCollab = useMemo(() => {
    const map = {}
    collabs.forEach(c => {
      map[c.id] = { collab: c, osItems: [], taskItems: [], total: 0 }
    })
    osItems.forEach(o => {
      const cid = o.providers?.id || o.collaborator_id
      if (!map[cid]) return
      const val = Number(o.labor_value) || Number(o.total_value) || Number(map[cid].collab.payment_rate) || 0
      map[cid].osItems.push({ ...o, payValue: val })
      map[cid].total += val
    })
    taskItems.forEach(t => {
      const cid = t.providers?.id || t.provider_id
      if (!map[cid]) return
      const val = Number(t.providers?.payment_rate) || 0
      map[cid].taskItems.push({ ...t, payValue: val })
      map[cid].total += val
    })
    return Object.values(map).filter(g => g.osItems.length > 0 || g.taskItems.length > 0)
  }, [collabs, osItems, taskItems])

  const totalPending = pendingByCollab.reduce((a, g) => a + g.total, 0)

  // ── Pagar item (OS ou Tarefa) ─────────────────────────────────────────────
  async function payItem(item, kind, value, collabId) {
    setPaying(item.id + kind)
    const now = new Date().toISOString()
    const amount = Number(value) || 0
    const company_id = await getCompanyId()

    if (kind === 'OS') {
      await supabase.from('service_orders').update({
        collaborator_paid:       true,
        collaborator_paid_at:    now,
        collaborator_paid_value: amount,
      }).eq('id', item.id)
    } else {
      await supabase.from('tasks').update({
        collaborator_paid:       true,
        collaborator_paid_at:    now,
        collaborator_paid_value: amount,
      }).eq('id', item.id)
    }

    // Cria lançamento no caixa como Despesa
    if (amount > 0) {
      await supabase.from('cash_flow').insert({
        type:            'despesa',
        category:        'Pagamento Terceirizado',
        description:     kind === 'OS'
          ? `Pagamento ${item.providers?.name || ''} — ${item.os_number || ''} ${item.title}`
          : `Pagamento ${item.providers?.name || ''} — Tarefa: ${item.title}`,
        amount,
        date:            now.slice(0, 10),
        collaborator_id: collabId,
        paid:            true,
        company_id,
      })
    }

    showToast(`Pagamento registrado ✓ — ${fmtMoney(amount)} lançado no caixa`)
    setPaying(null)
    load()
  }

  // ── Pagar todos de um colaborador de uma vez ──────────────────────────────
  async function payAll(group) {
    if (!confirm(`Pagar todos os serviços pendentes de ${group.collab.name}?\nTotal: ${fmtMoney(group.total)}`)) return
    setPaying('all_' + group.collab.id)
    const now = new Date().toISOString()
    const company_id = await getCompanyId()

    // OS
    for (const o of group.osItems) {
      await supabase.from('service_orders').update({
        collaborator_paid: true,
        collaborator_paid_at: now,
        collaborator_paid_value: o.payValue,
      }).eq('id', o.id)
    }
    // Tarefas
    for (const t of group.taskItems) {
      await supabase.from('tasks').update({
        collaborator_paid: true,
        collaborator_paid_at: now,
        collaborator_paid_value: t.payValue,
      }).eq('id', t.id)
    }
    // Um único lançamento consolidado no caixa
    if (group.total > 0) {
      await supabase.from('cash_flow').insert({
        type:            'despesa',
        category:        'Pagamento Terceirizado',
        description:     `Pagamento consolidado — ${group.collab.name} (${group.osItems.length + group.taskItems.length} serviços)`,
        amount:          group.total,
        date:            now.slice(0, 10),
        collaborator_id: group.collab.id,
        paid:            true,
        company_id,
      })
    }

    showToast(`Todos os pagamentos de ${group.collab.name} registrados ✓`)
    setPaying(null)
    load()
  }

  const selected = pendingByCollab.find(g => g.collab.id === selectedId)

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '.75rem' }}>
        <h2 style={{ fontFamily: 'var(--mono)', fontSize: '1rem', color: 'var(--warn)', letterSpacing: '.04em' }}>💸 PAGAMENTOS DE COLABORADORES</h2>
        {selectedId && (
          <button className="btn-sec" onClick={() => setSelectedId(null)}>← Voltar</button>
        )}
      </div>

      {/* Abas */}
      <div className="stab-bar" style={{ marginBottom: '1rem' }}>
        <button className={`stab${tab === 'pendente' ? ' active' : ''}`} onClick={() => setTab('pendente')}>
          ⏳ Pendentes {pendingByCollab.length > 0 && `(${pendingByCollab.length})`}
        </button>
        <button className={`stab${tab === 'pago' ? ' active' : ''}`} onClick={() => setTab('pago')}>
          ✓ Histórico de Pagamentos
        </button>
      </div>

      {/* ── ABA PENDENTES ── */}
      {tab === 'pendente' && (
        <>
          {/* KPI total a pagar */}
          {totalPending > 0 && (
            <div className="cfg-card" style={{ padding: '1rem', marginBottom: '1rem', background: 'var(--warn)0d', borderColor: 'var(--warn)33', display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'var(--mono)', color: 'var(--warn)' }}>{fmtMoney(totalPending)}</div>
                <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: '.15rem', letterSpacing: '.06em', textTransform: 'uppercase' }}>Total pendente a pagar</div>
              </div>
              <div style={{ fontSize: '.82rem', color: 'var(--muted)' }}>
                {pendingByCollab.length} colaborador(es) · {pendingByCollab.reduce((a, g) => a + g.osItems.length + g.taskItems.length, 0)} serviço(s)
              </div>
            </div>
          )}

          {pendingByCollab.length === 0 ? (
            <div className="cfg-card">
              <div className="empty">✅ Nenhum pagamento pendente — todos os colaboradores estão em dia!</div>
            </div>
          ) : !selectedId ? (
            /* ── Lista de colaboradores ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
              {pendingByCollab.map(g => (
                <CollabSummaryCard
                  key={g.collab.id}
                  name={g.collab.name}
                  pending={g.osItems.length + g.taskItems.length}
                  total={g.total}
                  onClick={() => setSelectedId(g.collab.id)}
                />
              ))}
            </div>
          ) : selected ? (
            /* ── Detalhe do colaborador ── */
            <div>
              <div className="cfg-card" style={{ marginBottom: '1rem', padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.75rem' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1rem' }}>🔧 {selected.collab.name}</div>
                    <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginTop: '.2rem' }}>
                      Taxa padrão: {selected.collab.payment_rate ? fmtMoney(selected.collab.payment_rate) + ' / serviço' : 'não definida'}
                      {selected.collab.payment_notes && ` · ${selected.collab.payment_notes}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontWeight: 800, fontSize: '1.2rem', color: 'var(--warn)' }}>{fmtMoney(selected.total)}</div>
                    <button className="btn-primary" style={{ background: 'var(--warn)', borderColor: 'var(--warn)' }}
                      onClick={() => payAll(selected)} disabled={paying === 'all_' + selected.collab.id}>
                      {paying === 'all_' + selected.collab.id ? '⏳' : '💸 Pagar Tudo'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="cfg-card" style={{ overflowX: 'auto' }}>
                <table className="rep-table">
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Referência</th>
                      <th>Serviço / Tarefa</th>
                      <th>Conclusão</th>
                      <th>Valor</th>
                      <th>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.osItems.map(o => (
                      <tr key={'os_' + o.id}>
                        <td><span style={{ background: 'var(--blue)22', color: 'var(--blue)', padding: '.15rem .45rem', borderRadius: 5, fontSize: '.7rem', fontWeight: 700 }}>OS</span></td>
                        <td style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--blue)', fontSize: '.85rem' }}>{o.os_number}</td>
                        <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.title}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: 'var(--muted)' }}>{fmtDate(o.completed_at)}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--warn)', whiteSpace: 'nowrap' }}>{fmtMoney(o.payValue)}</td>
                        <td>
                          <button className="abtn" style={{ color: 'var(--green)', fontSize: '.72rem', padding: '.25rem .55rem' }}
                            onClick={() => payItem(o, 'OS', o.payValue, selected.collab.id)}
                            disabled={paying === o.id + 'OS'}>
                            {paying === o.id + 'OS' ? '⏳' : '✓ Pagar'}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {selected.taskItems.map(t => (
                      <tr key={'tk_' + t.id}>
                        <td><span style={{ background: 'var(--purple)22', color: 'var(--purple)', padding: '.15rem .45rem', borderRadius: 5, fontSize: '.7rem', fontWeight: 700 }}>Tarefa</span></td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '.8rem', color: 'var(--muted)' }}>#{t.id}</td>
                        <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: 'var(--muted)' }}>—</td>
                        <td style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--warn)', whiteSpace: 'nowrap' }}>{fmtMoney(t.payValue)}</td>
                        <td>
                          <button className="abtn" style={{ color: 'var(--green)', fontSize: '.72rem', padding: '.25rem .55rem' }}
                            onClick={() => payItem(t, 'Tarefa', t.payValue, selected.collab.id)}
                            disabled={paying === t.id + 'Tarefa'}>
                            {paying === t.id + 'Tarefa' ? '⏳' : '✓ Pagar'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* ── ABA HISTÓRICO ── */}
      {tab === 'pago' && (
        <div className="cfg-card" style={{ overflowX: 'auto' }}>
          {history.length === 0 ? (
            <div className="empty">Nenhum pagamento realizado ainda</div>
          ) : (
            <table className="rep-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Colaborador</th>
                  <th>Tipo</th>
                  <th>Referência</th>
                  <th>Valor Pago</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '.8rem', color: 'var(--muted)' }}>{fmtDate(h.collaborator_paid_at)}</td>
                    <td style={{ fontWeight: 600 }}>{h.collab || '—'}</td>
                    <td>
                      <span style={{
                        background: h.kind === 'OS' ? 'var(--blue)22' : 'var(--purple)22',
                        color: h.kind === 'OS' ? 'var(--blue)' : 'var(--purple)',
                        padding: '.15rem .45rem', borderRadius: 5, fontSize: '.7rem', fontWeight: 700,
                      }}>{h.kind}</span>
                    </td>
                    <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.label}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--green)', whiteSpace: 'nowrap' }}>
                      ✓ {fmtMoney(h.collaborator_paid_value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
