/**
 * Fila de aprovação de solicitações públicas
 * ADM visualiza, aprova (define prestador + urgência + campos extras) ou rejeita cada pedido
 */
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'

const URG_OPTS = [
  { value: 'critica', label: '🚨 Crítica'  },
  { value: 'alta',    label: '🔴 Alta'     },
  { value: 'media',   label: '🟡 Média'    },
  { value: 'baixa',   label: '🟢 Baixa'   },
]
const SLA_HOURS = { critica: 2, alta: 8, media: 24, baixa: 72 }

function addHours(date, h) { return new Date(date.getTime() + h * 3600000) }
function fmtDatetime(d) {
  if (!d) return '–'
  return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
// Valor mínimo para datetime-local (agora, no fuso local)
function nowLocalMin() {
  const d = new Date(); d.setSeconds(0, 0)
  return d.toISOString().slice(0, 16)
}

// ── Modal de aprovação completo ───────────────────────────────────────────────
function ApprovalModal({ req, providers, onConfirm, onCancel, saving }) {
  const photos = (() => { try { return req.photos ? JSON.parse(req.photos) : [] } catch { return [] } })()
  const [f, setF] = useState({
    urgency:         'media',
    assignee_id:     '',
    notes:           '',
    scheduled_start: '',
  })
  function set(k, v) { setF(p => ({ ...p, [k]: v })) }

  // Calcula previsão de conclusão e valida SLA
  const slaHours      = SLA_HOURS[f.urgency] || 24
  const scheduledDate = f.scheduled_start ? new Date(f.scheduled_start) : null
  const validDate     = scheduledDate && !isNaN(scheduledDate.getTime())
  const completion    = validDate ? addHours(scheduledDate, slaHours) : null
  const maxAllowedStart = addHours(new Date(), slaHours)
  const slaWarning = validDate && scheduledDate > maxAllowedStart

  const infoRow = (icon, label, value) => value ? (
    <div style={{ display: 'flex', gap: '.5rem', fontSize: '.83rem', lineHeight: 1.5 }}>
      <span style={{ flexShrink: 0 }}>{icon}</span>
      <span><strong style={{ color: 'var(--muted)', fontSize: '.72rem', fontFamily: 'var(--mono)', letterSpacing: '.06em' }}>{label}:</strong> {value}</span>
    </div>
  ) : null

  return (
    <div className="overlay open" style={{ zIndex: 9000 }}>
      <div className="modal" style={{ maxWidth: 560, width: '100%' }}>
        <div className="mhead">
          <span>✅ Aprovar solicitação #{req.id}</span>
          <button className="mclose" onClick={onCancel}>✕</button>
        </div>
        <div className="mbody" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Info completa do formulário público — read-only */}
          <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.5rem', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--blue)', fontFamily: 'var(--mono)', letterSpacing: '.08em', marginBottom: '.25rem' }}>
              📋 DADOS DA SOLICITAÇÃO
            </div>
            {infoRow('👤', 'SOLICITANTE', req.requester)}
            {infoRow('📞', 'TELEFONE',    req.requester_phone)}
            {infoRow('🏢', 'SETOR',       req.requester_sector)}
            {infoRow('📍', 'LOCAL',       req.sector)}
            {infoRow('🔧', 'TIPO',        req.category)}
            {req.description && (
              <div style={{ marginTop: '.25rem', padding: '.6rem .75rem', background: '#fff', borderRadius: 7, border: '1px solid var(--border)', fontSize: '.85rem', lineHeight: 1.55, color: 'var(--text)' }}>
                {req.description}
              </div>
            )}
          </div>

          {/* Fotos em miniatura */}
          {photos.length > 0 && (
            <div>
              <div className="flabel" style={{ marginBottom: '.4rem' }}>FOTOS</div>
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                {photos.map((p, i) => (
                  <img key={i} src={p} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1.5px solid var(--border)', cursor: 'pointer' }}
                    onClick={() => window.open(p)} />
                ))}
              </div>
            </div>
          )}

          {/* Admin: apenas Prestador e Urgência */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--blue)', fontFamily: 'var(--mono)', letterSpacing: '.08em', marginBottom: '.75rem' }}>
              👷 ATRIBUIÇÃO
            </div>
            <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 2, minWidth: 160 }}>
                <label className="flabel">PRESTADOR *</label>
                <select className="finput" value={f.assignee_id} onChange={e => set('assignee_id', e.target.value)}>
                  <option value="">Selecione…</option>
                  {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 130 }}>
                <label className="flabel">CRITICIDADE</label>
                <select className="finput" value={f.urgency} onChange={e => set('urgency', e.target.value)}>
                  {URG_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Previsão de início */}
          <div>
            <label className="flabel">PREVISÃO DE INÍCIO *</label>
            <input
              className="finput"
              type="datetime-local"
              value={f.scheduled_start}
              min={nowLocalMin()}
              onChange={e => set('scheduled_start', e.target.value)}
            />
            {/* Feedback em tempo real */}
            {f.scheduled_start && (
              <div style={{
                marginTop: '.5rem', padding: '.6rem .85rem', borderRadius: 8, fontSize: '.82rem',
                background: slaWarning ? '#fef3c7' : '#f0fdf4',
                border: `1px solid ${slaWarning ? '#fcd34d' : '#86efac'}`,
                color: slaWarning ? '#92400e' : '#166534',
              }}>
                {slaWarning ? (
                  <>
                    ⚠️ <strong>Atenção:</strong> para urgência <strong>{f.urgency}</strong> o SLA é de <strong>{slaHours}h</strong>.
                    Iniciar em {fmtDatetime(scheduledDate)} significa que o prazo já teria sido extrapolado.
                    {' '}Data limite para início: <strong>{fmtDatetime(maxAllowedStart)}</strong>.
                  </>
                ) : (
                  <>✅ Conclusão prevista: <strong>{fmtDatetime(completion)}</strong> ({slaHours}h de SLA)</>
                )}
              </div>
            )}
          </div>

          {/* Observações internas (opcional) */}
          <div>
            <label className="flabel">OBSERVAÇÕES INTERNAS (opcional)</label>
            <textarea className="finput" rows={2} value={f.notes} onChange={e => set('notes', e.target.value)}
              placeholder="Anotações adicionais para o prestador…" style={{ resize: 'vertical' }} />
          </div>

        </div>
        <div className="mfoot">
          <button className="btn-sec" onClick={onCancel}>Cancelar</button>
          <button
            className="btn-primary"
            onClick={() => {
              if (slaWarning) {
                if (!confirm(`⚠️ A data de início proposta ultrapassa o SLA de ${slaHours}h para urgência "${f.urgency}".\n\nData limite de início: ${fmtDatetime(maxAllowedStart)}\n\nDeseja aprovar mesmo assim?`)) return
              }
              onConfirm(f)
            }}
            disabled={saving || !f.assignee_id || !f.scheduled_start}
          >
            {saving ? 'Aprovando…' : '📤 Aprovar e notificar prestador'}
          </button>
        </div>
      </div>
    </div>
  )
}

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
  const [approving,  setApproving] = useState(null)  // request com modal aberto
  const [sectors,    setSectors]   = useState([])
  const [saving,     setSaving]    = useState(false)
  const [photoModal, setPhotoModal] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  async function load() {
    if (!_rqc.loaded) setLoading(true)
    const [rr, pr, cr, sr] = await Promise.all([
      supabase.from('tasks').select('*')
        .eq('source', 'publico').eq('needs_approval', true)
        .neq('status', 'cancelada')
        .order('id', { ascending: false }),
      supabase.from('providers').select('id,name').eq('active', 1).order('name'),
      supabase.from('companies').select('invite_code').limit(1).maybeSingle(),
      supabase.from('sectors').select('id,name').eq('active', 1).order('name'),
    ])
    if (!mountedRef.current) return
    _rqc.requests   = rr.data || []
    _rqc.providers  = pr.data || []
    _rqc.inviteCode = cr.data?.invite_code || ''
    _rqc.loaded     = true
    setRequests(_rqc.requests)
    setProviders(_rqc.providers)
    setSectors(sr.data || [])
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

  async function approve(req, formData) {
    setSaving(true)
    try {
      const prov  = providers.find(p => p.id === Number(formData.assignee_id))
      const hours = SLA_HOURS[formData.urgency] || 24
      const startDt = formData.scheduled_start ? new Date(formData.scheduled_start) : new Date()
      if (isNaN(startDt.getTime())) {
        showToast('Data de início inválida. Verifique o ano digitado.', 'err')
        return
      }
      const slaDt = addHours(startDt, hours)
      const fmt   = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })

      const updates = {
        needs_approval:    false,
        assignee_id:       Number(formData.assignee_id),
        assignee:          prov?.name || '',
        urgency:           formData.urgency,
        provider_notified: false,
        scheduled_start:   startDt.toISOString(),
        sla_deadline:      slaDt.toISOString(),
        due_date:          fmt.format(slaDt),
        ...(formData.notes && { notes: formData.notes.trim() }),
      }
      const { error } = await supabase.from('tasks').update(updates).eq('id', req.id)
      if (error) { showToast('Erro: ' + error.message, 'err'); return }
      fetch('/api/telegram/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: req.id }),
      }).catch(() => {})
      showToast(`Solicitação #${req.id} aprovada e enviada para ${prov?.name} ✓`)
      setApproving(null)
      _rqc.loaded = false
      load()
    } catch (e) {
      showToast('Erro inesperado: ' + e.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function reject(req) {
    if (!confirm(`Rejeitar a solicitação #${req.id} de ${req.requester}?`)) return
    await supabase.from('tasks').update({ status: 'cancelada', needs_approval: false }).eq('id', req.id)
    showToast(`Solicitação #${req.id} rejeitada`)
    _rqc.loaded = false
    load()
  }

  // ── Links públicos ─────────────────────────────────────────────────────────
  const portalUrl = `${window.location.origin}/portal${inviteCode ? `?c=${inviteCode}` : ''}`
  const qrPortal  = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(portalUrl)}`

  function copyPortal() { navigator.clipboard.writeText(portalUrl).then(() => showToast('Link do portal copiado! ✓')) }

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
        <div style={{ fontSize:'.75rem', color:'var(--muted)', fontFamily:'var(--mono)', letterSpacing:'.08em', marginBottom:'1rem' }}>
          🔗 LINKS PARA CLIENTES
        </div>

        {/* Portal unificado — destaque */}
        <div style={{ background:'linear-gradient(135deg,#1e3a5f,#2563eb)', borderRadius:12, padding:'1.25rem', marginBottom:'1rem', display:'flex', gap:'1.25rem', alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:200 }}>
            <div style={{ fontSize:'.72rem', fontWeight:700, color:'rgba(255,255,255,.7)', letterSpacing:'.08em', marginBottom:'.4rem' }}>
              🌐 PORTAL ÚNICO (solicitar + acompanhar)
            </div>
            <p style={{ fontSize:'.8rem', color:'rgba(255,255,255,.85)', marginBottom:'.65rem', lineHeight:1.4 }}>
              Um único QR/link para tudo — o cliente escolhe o que fazer.
            </p>
            <div style={{ display:'flex', gap:'.4rem', marginBottom:'.4rem' }}>
              <input readOnly value={portalUrl}
                style={{ flex:1, fontSize:'.72rem', fontFamily:'monospace', background:'rgba(255,255,255,.12)', border:'1px solid rgba(255,255,255,.25)', borderRadius:6, padding:'.4rem .6rem', color:'#fff' }} />
              <button onClick={copyPortal}
                style={{ background:'rgba(255,255,255,.2)', border:'1px solid rgba(255,255,255,.3)', borderRadius:6, color:'#fff', padding:'.4rem .7rem', cursor:'pointer', fontSize:'.78rem', fontWeight:700 }}>
                📋
              </button>
            </div>
            <a href={portalUrl} target="_blank" rel="noopener noreferrer"
              style={{ fontSize:'.75rem', color:'rgba(255,255,255,.8)', textDecoration:'none' }}>↗ Abrir portal</a>
          </div>
          <div style={{ textAlign:'center' }}>
            <img src={qrPortal} alt="QR Portal"
              style={{ width:140, height:140, borderRadius:10, background:'#fff', padding:6, display:'block' }} />
            <a href={qrPortal} download="qr-portal.png"
              style={{ fontSize:'.68rem', color:'rgba(255,255,255,.7)', textDecoration:'none', marginTop:'.3rem', display:'block' }}>⬇ Baixar QR</a>
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
                  <div style={{ display:'flex', gap:'.5rem' }}>
                    <button
                      className="btn-primary"
                      style={{ flex:1, fontSize:'.82rem' }}
                      onClick={() => setApproving(req)}
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

      {/* Modal de aprovação completo */}
      {approving && (
        <ApprovalModal
          req={approving}
          providers={providers}
          saving={saving}
          onConfirm={formData => approve(approving, formData)}
          onCancel={() => setApproving(null)}
        />
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
