/**
 * Página pública de acompanhamento de protocolo
 * Acessada via /acompanhar?c=INVITE_CODE  (e/ou ?p=NUMERO para pre-preencher)
 */
import { useState, useEffect } from 'react'

const STATUS_STEPS = ['pendente', 'em_andamento', 'concluida']

function fmtDate(iso) {
  if (!iso) return '–'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function PublicTrackForm() {
  const params      = new URLSearchParams(window.location.search)
  const inviteCode  = params.get('c') || ''
  const preProtocol = params.get('p') || ''

  const [protocol, setProtocol] = useState(preProtocol)
  const [result,   setResult]   = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [brand,    setBrand]    = useState({ logo_url: null, primary_color: '#2563eb', company_name: null })

  useEffect(() => {
    fetch(`/api/public/branding?c=${inviteCode}`).then(r => r.json())
      .then(d => { if (d.primary_color || d.logo_url) setBrand(d) }).catch(() => {})
    if (preProtocol) search(null, preProtocol)
  }, [])

  const color     = brand.primary_color || '#2563eb'
  const colorDark = '#1e3a5f'

  async function search(e, forceProt) {
    if (e) e.preventDefault()
    const prot = (forceProt || protocol).toString().replace(/\D/g, '')
    setError('')
    setResult(null)
    if (!prot) return setError('Informe o número do protocolo.')
    setLoading(true)
    try {
      const res  = await fetch(`/api/public/track?p=${prot}&c=${inviteCode}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Protocolo não encontrado')
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const currentStep = result ? STATUS_STEPS.indexOf(result.status) : -1

  return (
    <div style={{ ...S.page, background: `linear-gradient(135deg, ${colorDark} 0%, ${color} 100%)` }}>

      {/* Logo da empresa */}
      <div style={{ width: '100%', maxWidth: 480, marginBottom: '1.25rem', marginTop: '1rem', textAlign: 'center' }}>
        {brand.logo_url ? (
          <img src={brand.logo_url} alt={brand.company_name || 'Logo'}
            style={{ maxHeight: 80, maxWidth: 480, width: 'auto', objectFit: 'contain',
              filter: 'drop-shadow(0 3px 14px rgba(0,0,0,.45))' }} />
        ) : (
          <img src="/logo.png" alt="DespachaApp"
            style={{ width: '100%', maxWidth: 480, height: 'auto', objectFit: 'contain',
              filter: 'drop-shadow(0 3px 14px rgba(0,0,0,.45))' }}
            onError={e => { e.target.style.display = 'none' }} />
        )}
      </div>

      <div style={S.card}>

        {/* Header com cor da empresa */}
        <div style={{ ...S.header, background: `linear-gradient(135deg, ${colorDark}, ${color})` }}>
          <div style={S.headerIcon}>🔍</div>
          <div>
            <h1 style={S.headerTitle}>Acompanhar Solicitação</h1>
            <p style={S.headerSub}>Digite o número do protocolo para consultar o status.</p>
          </div>
        </div>

        {/* Busca */}
        <form onSubmit={search} style={{ padding: '1.25rem 1.25rem .75rem' }}>
          <div style={{ display: 'flex', gap: '.6rem' }}>
            <input
              style={{ ...S.input, flex: 1, fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 700, letterSpacing: '.08em' }}
              placeholder="Ex: 00010"
              value={protocol}
              onChange={e => setProtocol(e.target.value.replace(/\D/g, ''))}
              maxLength={10}
              inputMode="numeric"
            />
            <button type="submit" style={{ ...S.btnSearch, opacity: loading ? .7 : 1 }} disabled={loading}>
              {loading ? '⏳' : '🔍 Buscar'}
            </button>
          </div>
          {error && <div style={S.errorBox}>⚠️ {error}</div>}
        </form>

        {/* Resultado */}
        {result && (
          <div style={{ padding: '0 1.25rem 1.5rem' }}>

            {/* Status principal */}
            <div style={{ ...S.statusBox, borderColor: result.statusColor + '55', background: result.statusColor + '11' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '.4rem' }}>{result.statusIcon}</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: result.statusColor, marginBottom: '.2rem' }}>
                {result.statusLabel}
              </div>
              <div style={{ fontSize: '.78rem', color: '#6b7280' }}>
                Protocolo <strong style={{ color: '#1a1a2e', fontFamily: 'monospace' }}>
                  #{String(result.protocol).padStart(5, '0')}
                </strong>
              </div>
            </div>

            {/* Barra de progresso */}
            {result.status !== 'cancelada' && (
              <div style={S.stepsWrap}>
                {['Aguardando', 'Em atendimento', 'Concluído'].map((lbl, i) => (
                  <div key={i} style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
                    {/* Linha conectora */}
                    {i < 2 && (
                      <div style={{
                        position: 'absolute', top: 14, left: '50%', width: '100%', height: 3,
                        background: currentStep > i ? '#10b981' : '#e5e7eb',
                        transition: 'background .4s',
                      }} />
                    )}
                    {/* Círculo */}
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', margin: '0 auto .4rem',
                      background: currentStep >= i ? (i === 2 ? '#10b981' : i === 1 ? '#3b82f6' : '#f59e0b') : '#e5e7eb',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '.8rem', color: '#fff', fontWeight: 700,
                      position: 'relative', zIndex: 1,
                      boxShadow: currentStep === i ? `0 0 0 4px ${['#f59e0b','#3b82f6','#10b981'][i]}33` : 'none',
                      transition: 'all .4s',
                    }}>
                      {currentStep > i ? '✓' : i + 1}
                    </div>
                    <div style={{ fontSize: '.68rem', color: currentStep >= i ? '#374151' : '#9ca3af', fontWeight: currentStep === i ? 700 : 400 }}>
                      {lbl}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Detalhes */}
            <div style={S.detailsBox}>
              <Row label="Descrição"    value={result.description} />
              {result.sector   && <Row label="Local / Setor"  value={result.sector} />}
              {result.assignee && <Row label="Técnico"        value={result.assignee} />}
              <Row label="Aberto em"   value={fmtDate(result.createdAt)} />
              {result.updatedAt !== result.createdAt &&
                <Row label="Atualizado" value={fmtDate(result.updatedAt)} />}
            </div>

          </div>
        )}

        {/* Link para abrir nova solicitação */}
        <div style={S.footer}>
          <a href={`/solicitar${inviteCode ? '?c=' + inviteCode : ''}`} style={S.newLink}>
            ＋ Abrir nova solicitação
          </a>
          <div style={{ marginTop: '.5rem', fontSize: '.72rem', color: '#9ca3af' }}>
            Powered by <strong>DespachaApp</strong>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  if (!value) return null
  return (
    <div style={{ marginBottom: '.6rem' }}>
      <div style={{ fontSize: '.68rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '.15rem' }}>{label}</div>
      <div style={{ fontSize: '.9rem', color: '#1a1a2e', lineHeight: 1.45 }}>{value}</div>
    </div>
  )
}

// ── Estilos ──────────────────────────────────────────────────────────────────
const S = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'flex-start', padding: '1.5rem 1rem 3rem',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  card: {
    background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480,
    boxShadow: '0 20px 60px rgba(0,0,0,.25)', overflow: 'hidden',
  },
  header: {
    background: 'linear-gradient(135deg, #1e3a5f, #2563eb)',
    color: '#fff', padding: '1.5rem',
    display: 'flex', alignItems: 'center', gap: '1rem',
  },
  headerIcon: {
    fontSize: '1.8rem', background: 'rgba(255,255,255,.15)', borderRadius: 12,
    width: 52, height: 52, display: 'flex', alignItems: 'center',
    justifyContent: 'center', flexShrink: 0,
  },
  headerTitle: { margin: 0, fontSize: '1.2rem', fontWeight: 800, letterSpacing: '.02em' },
  headerSub: { margin: '.25rem 0 0', fontSize: '.8rem', opacity: .85, lineHeight: 1.4 },
  input: {
    padding: '.7rem .9rem', border: '1.5px solid #e5e7eb', borderRadius: 8,
    fontSize: '.95rem', color: '#1a1a2e', outline: 'none',
    boxSizing: 'border-box', background: '#fafafa',
  },
  btnSearch: {
    padding: '.7rem 1.2rem', background: 'linear-gradient(135deg,#1e3a5f,#2563eb)',
    color: '#fff', border: 'none', borderRadius: 8, fontSize: '.9rem',
    fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  errorBox: {
    background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626',
    borderRadius: 8, padding: '.55rem .9rem', fontSize: '.85rem', marginTop: '.6rem',
  },
  statusBox: {
    border: '2px solid', borderRadius: 14, padding: '1.5rem 1rem',
    textAlign: 'center', marginBottom: '1.25rem',
  },
  stepsWrap: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    marginBottom: '1.25rem', padding: '0 .5rem',
  },
  detailsBox: {
    background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
    padding: '1rem', marginTop: '.25rem',
  },
  footer: {
    textAlign: 'center', padding: '.9rem 1rem 1rem',
    borderTop: '1px solid #f3f4f6',
  },
  newLink: {
    fontSize: '.85rem', color: '#2563eb', fontWeight: 600,
    textDecoration: 'none', display: 'inline-block', padding: '.4rem .8rem',
    borderRadius: 6, background: '#eff6ff',
  },
}
