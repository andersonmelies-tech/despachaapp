/**
 * Fila de aprovação de solicitações públicas
 * ADM visualiza, aprova (define prestador + urgência) ou rejeita cada pedido
 */
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'

const URG_OPTS = [
  { value: 'critica', label: '🚨 Crítica'  },
  { value: 'alta',    label: '🔴 Alta'     },
  { value: 'media',   label: '🟡 Média'    },
  { value: 'baixa',   label: '🟢 Baixa'   },
]

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
}

// Cache do componente
const _rqc = { requests: [], providers: [], loaded: false, inviteCode: '' }

export default function RequestQueue({ showToast, onCountChange }) {
  const [requests,   setRequests]  = useState(_rqc.requests)
  const [providers,  setProviders] = useState(_rqc.providers)
  const [loading,    setLoading]   = useState(!_rqc.loaded)
  const [tab,        setTab]       = useState('pending')  // pending | done
  const [history,    setHistory]   = useState([])
  const [inviteCode, setInviteCode] = useState(_rqc.inviteCode)
  const [approving,  setApproving] = useState(null)  // request sendo aprovada
  const [selProv,    setSelProv]   = useState('')
  const [selUrg,     setSelUrg]    = useState('media')
  const [saving,     setSaving]    = useState(false)
  const [photoModal, setPhotoModal] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  async function load() {
    if (!_rqc.loaded) setLoading(true)
    const [rr, pr, cr] = await Promise.all([
      supabase.from('tasks').select('*')
        .eq('source', 'publico').eq('needs_approval', true)
        .neq('status', 'cancelada')
        .order('id', { ascending: false }),
      supabase.from('providers').select('id,name').eq('active', 1).order('name'),
      supabase.from('companies').select('invite_code').limit(1).maybeSingle(),
    ])
    if (!mountedRef.current) return
    _rqc.requests   = rr.data || []
    _rqc.providers  = pr.data || []
    _rqc.inviteCode = cr.data?.invite_code || ''
    _rqc.loaded     = true
    setRequests(_rqc.requests)
    setProviders(_rqc.providers)
    setInviteCode(_rqc.inviteCode)
    setLoading(false)
    onCountChange?.(_rqc.requests.length)
  }

  async function loadHistory() {
    const { data } = await supabase.from('tasks').select('*')
      .eq('source', 'publico').eq('needs_approval', false)
      .neq('status', 'cancelada')
      .order('id', { ascending: false }).limit(50)
    if (!mountedRef.current) return
    setHistory(data || [])
  }

  useEffect(() => { load() }, [])
  useEffect(() => { if (tab === 'done') loadHistory() }, [tab])

  // ── Realtime: novas solicitações entram automaticamente ──────────────────────
  useEffect(() => {
    const ch = supabase.channel('rt-requests')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tasks' },
        ({ new: t }) => {
          if (!mountedRef.current || t.source !== 'publico') return
          _rqc.requests = [t, ..._rqc.requests]
          setRequests([..._rqc.requests])
          onCountChange?.(_rqc.requests.length)
          showToast(`📥 Nova solicitação de ${t.requester}`)
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tasks' },
        ({ new: t }) => {
          if (!mountedRef.current || t.source !== 'publico') return
          // Remove da fila quando aprovada ou cancelada
          if (!t.needs_approval || t.status === 'cancelada') {
            _rqc.requests = _rqc.requests.filter(r => r.id !== t.id)
            setRequests([..._rqc.requests])
            onCountChange?.(_rqc.requests.length)
          }
        }
      )
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  async function approve(req) {
    if (!selProv) return showToast('Selecione um prestador', 'err')
    setSaving(true)
    const prov = providers.find(p => p.id === Number(selProv))
    const { error } = await supabase.from('tasks').update({
      needs_approval:    false,
      assignee_id:       Number(selProv),
      assignee:          prov?.name || '',
      urgency:           selUrg,
      provider_notified: false,  // vai notificar via telegram
    }).eq('id', req.id)
    if (error) { showToast('Erro: ' + error.message, 'err'); setSaving(false); return }
    // Notifica via Telegram
    fetch('/api/telegram/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: req.id }),
    }).catch(() => {})
    showToast(`Solicitação #${req.id} aprovada e enviada para ${prov?.name} ✓`)
    setSaving(false)
    setApproving(null)
    setSelProv(''); setSelUrg('media')
    _rqc.loaded = false
    load()
  }

  async function reject(req) {
    if (!confirm(`Rejeitar a solicitação #${req.id} de ${req.requester}?`)) return
    await supabase.from('tasks').update({ status: 'cancelada', needs_approval: false }).eq('id', req.id)
    showToast(`Solicitação #${req.id} rejeitada`)
    _rqc.loaded = false
    load()
  }

  // ── Link público ──────────────────────────────────────────────────────────
  const publicUrl = `${window.location.origin}/solicitar${inviteCode ? `?c=${inviteCode}` : ''}`
  const qrUrl     = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(publicUrl)}`

  function copyLink() {
    navigator.clipboard.writeText(publicUrl).then(() => showToast('Link copiado! ✓'))
  }

  // ── Fotos ─────────────────────────────────────────────────────────────────
  function getPhotos(task) {
    if (!task.photos) return []
    try { return JSON.parse(task.photos) } catch { return [] }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem', flexWrap:'wrap', gap:'.75rem' }}>
        <h2 style={{ fontFamily:'var(--mono)', fontSize:'1rem', color:'var(--blue)', letterSpacing:'.04em' }}>
          📥 SOLICITAÇÕES PÚBLICAS
          {requests.length > 0 && (
            <span style={{ marginLeft:'.6rem', background:'var(--red)', color:'#fff', borderRadius:99, padding:'1px 8px', fontSize:'.7rem', fontWeight:700 }}>
              {requests.length}
            </span>
          )}
        </h2>
        <button className="btn-primary" onClick={() => { _rqc.loaded = false; load() }}>↻ Atualizar</button>
      </div>

      {/* Link público + QR */}
      <div className="cfg-card" style={{ marginBottom:'1.25rem', padding:'1.25rem' }}>
        <div style={{ fontSize:'.75rem', color:'var(--muted)', fontFamily:'var(--mono)', letterSpacing:'.08em', marginBottom:'.75rem' }}>
          🔗 LINK PARA CLIENTES
        </div>
        <div style={{ display:'flex', gap:'2rem', alignItems:'flex-start', flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:240 }}>
            <p style={{ fontSize:'.82rem', color:'var(--muted)', marginBottom:'.75rem', lineHeight:1.5 }}>
              Compartilhe este link ou QR Code com seus clientes. Eles preenchem o formulário sem precisar de cadastro.
            </p>
            <div style={{ display:'flex', gap:'.5rem', marginBottom:'.5rem' }}>
              <input
                className="finput"
                readOnly
                value={publicUrl}
                style={{ flex:1, fontSize:'.78rem', fontFamily:'var(--mono)', background:'var(--bg)' }}
              />
              <button className="btn-primary" onClick={copyLink} style={{ whiteSpace:'nowrap' }}>
                📋 Copiar
              </button>
            </div>
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize:'.78rem', color:'var(--blue)', textDecoration:'none' }}
            >
              ↗ Abrir formulário
            </a>
          </div>
          <div style={{ textAlign:'center' }}>
            <img src={qrUrl} alt="QR Code" style={{ width:140, height:140, borderRadius:8, border:'1px solid var(--border)' }} />
            <div style={{ fontSize:'.7rem', color:'var(--muted)', marginTop:'.4rem' }}>QR Code</div>
            <a
              href={qrUrl}
              download="qrcode-solicitacao.png"
              style={{ fontSize:'.72rem', color:'var(--blue)', textDecoration:'none' }}
            >
              ⬇ Baixar QR
            </a>
          </div>
        </div>
      </div>

      {/* Abas */}
      <div style={{ display:'flex', gap:'.5rem', marginBottom:'1rem' }}>
        {[
          { id:'pending', label:`⏳ Aguardando (${requests.length})` },
          { id:'done',    label:'✅ Aprovadas' },
        ].map(t => (
          <button
            key={t.id}
            className={tab === t.id ? 'btn-primary' : 'btn-sec'}
            onClick={() => setTab(t.id)}
            style={{ fontSize:'.82rem' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="cfg-card"><div className="empty">Carregando…</div></div>
      ) : tab === 'pending' ? (
        requests.length === 0 ? (
          <div className="cfg-card"><div className="empty">Nenhuma solicitação pendente 🎉</div></div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:'.75rem' }}>
            {requests.map(req => {
              const photos = getPhotos(req)
              const isApprov = approving?.id === req.id
              return (
                <div key={req.id} className="cfg-card" style={{ padding:'1rem' }}>
                  {/* Cabeçalho do card */}
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'.6rem' }}>
                    <div>
                      <div style={{ fontWeight:700, fontSize:'.95rem' }}>
                        #{req.id} — {req.requester}
                      </div>
                      <div style={{ fontSize:'.78rem', color:'var(--muted)', marginTop:'.15rem' }}>
                        📞 {req.requester_phone || '—'}
                        {req.client_address && <span>  ·  📍 {req.client_address}</span>}
                        <span style={{ marginLeft:'.5rem' }}>🕐 {fmtDate(req.created_at)}</span>
                      </div>
                    </div>
                    <span style={{ fontSize:'.7rem', background:'#fef3c7', color:'#92400e', padding:'2px 8px', borderRadius:99, fontWeight:700, whiteSpace:'nowrap' }}>
                      ⏳ Pendente
                    </span>
                  </div>

                  {/* Descrição */}
                  <div style={{ background:'var(--bg)', borderRadius:8, padding:'.65rem .85rem', fontSize:'.87rem', lineHeight:1.55, marginBottom:'.6rem', color:'var(--text)' }}>
                    {req.description || req.title}
                  </div>

                  {/* Fotos */}
                  {photos.length > 0 && (
                    <div style={{ display:'flex', gap:'.4rem', marginBottom:'.6rem', flexWrap:'wrap' }}>
                      {photos.map((p, i) => (
                        <img
                          key={i}
                          src={p}
                          alt=""
                          style={{ width:64, height:64, objectFit:'cover', borderRadius:6, cursor:'pointer', border:'1.5px solid var(--border)' }}
                          onClick={() => setPhotoModal(p)}
                        />
                      ))}
                    </div>
                  )}

                  {/* Botões de ação */}
                  {!isApprov ? (
                    <div style={{ display:'flex', gap:'.5rem' }}>
                      <button
                        className="btn-primary"
                        style={{ flex:1, fontSize:'.82rem' }}
                        onClick={() => { setApproving(req); setSelProv(''); setSelUrg('media') }}
                      >
                        ✅ Aprovar
                      </button>
                      <button
                        className="abtn r"
                        onClick={() => reject(req)}
                        style={{ fontSize:'.82rem', padding:'.4rem .9rem' }}
                      >
                        ❌ Rejeitar
                      </button>
                    </div>
                  ) : (
                    /* Formulário de aprovação inline */
                    <div style={{ background:'var(--bg)', borderRadius:8, padding:'.85rem', border:'1.5px solid var(--blue)44' }}>
                      <div style={{ fontSize:'.72rem', color:'var(--blue)', fontFamily:'var(--mono)', letterSpacing:'.08em', marginBottom:'.65rem' }}>
                        ✅ APROVAR E ENCAMINHAR
                      </div>
                      <div style={{ display:'flex', gap:'.65rem', flexWrap:'wrap', marginBottom:'.65rem' }}>
                        <div style={{ flex:2, minWidth:160 }}>
                          <label className="flabel">PRESTADOR *</label>
                          <select className="finput" value={selProv} onChange={e => setSelProv(e.target.value)}>
                            <option value="">Selecione…</option>
                            {providers.map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                        <div style={{ flex:1, minWidth:130 }}>
                          <label className="flabel">URGÊNCIA</label>
                          <select className="finput" value={selUrg} onChange={e => setSelUrg(e.target.value)}>
                            {URG_OPTS.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div style={{ display:'flex', gap:'.5rem' }}>
                        <button className="btn-primary" style={{ flex:1, fontSize:'.82rem' }}
                          onClick={() => approve(req)} disabled={saving}>
                          {saving ? 'Enviando…' : '📤 Confirmar e notificar prestador'}
                        </button>
                        <button className="btn-sec" style={{ fontSize:'.82rem' }}
                          onClick={() => setApproving(null)}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      ) : (
        /* Aba aprovadas */
        history.length === 0 ? (
          <div className="cfg-card"><div className="empty">Nenhuma solicitação aprovada ainda</div></div>
        ) : (
          <div className="cfg-card">
            {history.map((req, i) => (
              <div key={req.id} style={{ padding:'.75rem 0', borderBottom: i < history.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ fontWeight:600, fontSize:'.88rem' }}>#{req.id} — {req.requester}</div>
                    <div style={{ fontSize:'.75rem', color:'var(--muted)' }}>
                      📞 {req.requester_phone || '—'} · 👷 {req.assignee || '—'} · {fmtDate(req.created_at)}
                    </div>
                  </div>
                  <span style={{ fontSize:'.72rem', fontFamily:'var(--mono)', color:'var(--green)' }}>✅ Aprovada</span>
                </div>
                <div style={{ fontSize:'.82rem', color:'var(--muted)', marginTop:'.25rem' }}>{req.title}</div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Modal de foto */}
      {photoModal && (
        <div
          className="overlay open"
          onClick={() => setPhotoModal(null)}
          style={{ zIndex:9999 }}
        >
          <div style={{ maxWidth:'90vw', maxHeight:'90vh' }}>
            <img src={photoModal} alt="" style={{ maxWidth:'90vw', maxHeight:'85vh', objectFit:'contain', borderRadius:12 }} />
            <button
              className="mclose"
              onClick={() => setPhotoModal(null)}
              style={{ position:'fixed', top:'1rem', right:'1rem', background:'#fff', borderRadius:'50%', padding:'.4rem .6rem' }}
            >✕</button>
          </div>
        </div>
      )}
    </div>
  )
}
