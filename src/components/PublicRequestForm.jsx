/**
 * Formulário público de solicitação de serviço
 * Acessado via /solicitar?c=INVITE_CODE
 * Sem autenticação — qualquer pessoa pode abrir chamado
 */
import { useState, useRef, useEffect } from 'react'

// Comprime imagem via canvas antes de enviar
function compressImage(file, maxPx = 1200, quality = 0.72) {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const w = Math.round(img.width  * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.src = url
  })
}

export default function PublicRequestForm() {
  const params     = new URLSearchParams(window.location.search)
  const inviteCode = params.get('c') || ''

  const [f, setF] = useState({ name: '', phone: '', location: '', description: '' })
  const [photos,    setPhotos]  = useState([])
  const [sending,   setSending] = useState(false)
  const [done,      setDone]    = useState(null)  // { protocol }
  const [error,     setError]   = useState('')
  const [sectors,   setSectors] = useState([])
  const [brand,     setBrand]   = useState({ logo_url: null, primary_color: '#2563eb', company_name: null })
  const fileRef = useRef()

  // Carrega branding e setores em paralelo
  useEffect(() => {
    Promise.all([
      fetch(`/api/public/branding?c=${inviteCode}`).then(r => r.json()).catch(() => ({})),
      inviteCode ? fetch(`/api/public/sectors?c=${inviteCode}`).then(r => r.json()).catch(() => ({})) : Promise.resolve({}),
    ]).then(([b, s]) => {
      if (b.primary_color || b.logo_url) setBrand(b)
      if (s.sectors?.length) setSectors(s.sectors)
    })
  }, [inviteCode])

  const color     = brand.primary_color || '#2563eb'
  const colorDark = '#1e3a5f'

  function set(k, v) { setF(p => ({ ...p, [k]: v })) }

  async function addPhotos(files) {
    const compressed = await Promise.all(Array.from(files).slice(0, 3).map(compressImage))
    setPhotos(p => [...p, ...compressed].slice(0, 3))
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!f.name.trim())        return setError('Informe seu nome.')
    if (!f.phone.trim())       return setError('Informe seu telefone.')
    if (!f.description.trim()) return setError('Descreva o problema.')

    // Resolve o local: se selecionou "Outro", usa o campo livre
    const locationValue = f.location === '__outro__'
      ? (f.locationCustom?.trim() || null)
      : (f.location?.trim() || null)

    setSending(true)
    try {
      const res = await fetch('/api/public/request', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:        f.name.trim(),
          phone:       f.phone.trim(),
          location:    locationValue,
          description: f.description.trim(),
          photos:      photos.length ? photos : null,
          invite_code: inviteCode,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar')
      setDone({ protocol: data.protocol })
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  // ── Tela de sucesso ──────────────────────────────────────────────────────────
  if (done) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>✅</div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: '.5rem', color: '#1a1a2e' }}>
              Solicitação enviada!
            </h2>
            <p style={{ color: '#666', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              Sua solicitação foi registrada. Em breve nossa equipe entrará em contato.
            </p>
            <div style={styles.protocolBox}>
              <div style={{ fontSize: '.75rem', color: '#888', marginBottom: '.25rem', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                Número do protocolo
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 900, fontFamily: 'monospace', color: '#2563eb' }}>
                #{String(done.protocol).padStart(5, '0')}
              </div>
            </div>
            <p style={{ fontSize: '.8rem', color: '#999', marginTop: '1rem' }}>
              Guarde este número para acompanhar seu atendimento.
            </p>
            {/* Botão para acompanhar */}
            <a
              href={`/acompanhar?p=${done.protocol}${inviteCode ? '&c=' + inviteCode : ''}`}
              style={{ ...styles.btnSubmit, display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: '1rem', fontSize: '.95rem' }}
            >
              🔍 Acompanhar minha solicitação
            </a>
            <button
              style={styles.btnSecondary}
              onClick={() => { setDone(null); setF({ name: '', phone: '', location: '', description: '', locationCustom: '' }); setPhotos([]) }}
            >
              Nova solicitação
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Formulário ───────────────────────────────────────────────────────────────
  return (
    <div style={{ ...styles.page, background: `linear-gradient(135deg, ${colorDark} 0%, ${color} 100%)` }}>

      {/* Logo da empresa acima do card */}
      <div style={{ width: '100%', maxWidth: 480, marginBottom: '1.25rem', marginTop: '1rem', textAlign: 'center' }}>
        {brand.logo_url ? (
          <img
            src={brand.logo_url}
            alt={brand.company_name || 'Logo'}
            style={{ maxHeight: 80, maxWidth: 480, width: 'auto', height: 'auto', objectFit: 'contain',
              filter: 'drop-shadow(0 3px 14px rgba(0,0,0,.45))' }}
          />
        ) : (
          <img
            src="/logo.png"
            alt="DespachaApp"
            style={{ width: '100%', maxWidth: 480, height: 'auto', objectFit: 'contain',
              filter: 'drop-shadow(0 3px 14px rgba(0,0,0,.45))' }}
            onError={e => { e.target.style.display = 'none' }}
          />
        )}
      </div>

      <div style={styles.card}>

        {/* Header com cor da empresa */}
        <div style={{ ...styles.header, background: `linear-gradient(135deg, ${colorDark}, ${color})` }}>
          <img
            src="/icon.png"
            alt=""
            style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 14,
              flexShrink: 0, boxShadow: '0 2px 10px rgba(0,0,0,.3)' }}
            onError={e => { e.target.style.display = 'none' }}
          />
          <div>
            <h1 style={styles.headerTitle}>Solicitar Serviço</h1>
            <p style={styles.headerSub}>Preencha o formulário abaixo. Nossa equipe irá atender você.</p>
          </div>
        </div>

        <form onSubmit={submit} style={{ padding: '1.25rem' }}>

          {/* Nome */}
          <div style={styles.field}>
            <label style={styles.label}>SEU NOME *</label>
            <input
              style={styles.input}
              placeholder="Nome completo"
              value={f.name}
              onChange={e => set('name', e.target.value)}
              autoComplete="name"
            />
          </div>

          {/* Telefone */}
          <div style={styles.field}>
            <label style={styles.label}>TELEFONE / WHATSAPP *</label>
            <input
              style={styles.input}
              placeholder="(47) 99999-9999"
              value={f.phone}
              onChange={e => set('phone', e.target.value)}
              type="tel"
              autoComplete="tel"
            />
          </div>

          {/* Local / Setor */}
          <div style={styles.field}>
            <label style={styles.label}>LOCAL / SETOR</label>
            {sectors.length > 0 ? (
              <select
                style={{ ...styles.input, cursor: 'pointer', color: f.location ? '#1a1a2e' : '#9ca3af' }}
                value={f.location}
                onChange={e => set('location', e.target.value)}
              >
                <option value="">Selecione o setor…</option>
                {sectors.map(s => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
                <option value="__outro__">Outro (digitar abaixo)</option>
              </select>
            ) : (
              <input
                style={styles.input}
                placeholder="Ex: Sala 3, Recepção, Galpão B..."
                value={f.location}
                onChange={e => set('location', e.target.value)}
              />
            )}
            {/* Campo livre quando "Outro" selecionado */}
            {f.location === '__outro__' && (
              <input
                style={{ ...styles.input, marginTop: '.5rem' }}
                placeholder="Descreva o local..."
                value={f.locationCustom || ''}
                onChange={e => setF(p => ({ ...p, locationCustom: e.target.value }))}
                autoFocus
              />
            )}
          </div>

          {/* Descrição */}
          <div style={styles.field}>
            <label style={styles.label}>DESCREVA O PROBLEMA *</label>
            <textarea
              style={{ ...styles.input, resize: 'vertical', minHeight: 100 }}
              placeholder="Detalhe o que está acontecendo para que possamos atender melhor..."
              value={f.description}
              onChange={e => set('description', e.target.value)}
              rows={4}
            />
          </div>

          {/* Fotos */}
          <div style={styles.field}>
            <label style={styles.label}>FOTO DO PROBLEMA (opcional)</label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              style={{ display: 'none' }}
              onChange={e => addPhotos(e.target.files)}
            />
            <button
              type="button"
              style={styles.btnPhoto}
              onClick={() => fileRef.current?.click()}
            >
              📷 {photos.length > 0 ? `${photos.length} foto(s) selecionada(s)` : 'Tirar foto / Selecionar'}
            </button>

            {photos.length > 0 && (
              <div style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem', flexWrap: 'wrap' }}>
                {photos.map((p, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={p} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '2px solid #e5e7eb' }} />
                    <button
                      type="button"
                      onClick={() => setPhotos(pp => pp.filter((_, j) => j !== i))}
                      style={{ position: 'absolute', top: -6, right: -6, background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', fontSize: 11, lineHeight: '20px', padding: 0 }}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Erro */}
          {error && (
            <div style={styles.errorBox}>⚠️ {error}</div>
          )}

          {/* Submit */}
          <button
            type="submit"
            style={{ ...styles.btnSubmit, background: `linear-gradient(135deg, ${colorDark}, ${color})`, opacity: sending ? .7 : 1 }}
            disabled={sending}
          >
            {sending ? '⏳ Enviando…' : '📤 ENVIAR SOLICITAÇÃO'}
          </button>

        </form>

        <div style={styles.footer}>
          <a
            href={`/acompanhar${inviteCode ? '?c=' + inviteCode : ''}`}
            style={{ display: 'inline-block', marginBottom: '.6rem', fontSize: '.82rem', color: '#2563eb', fontWeight: 600, textDecoration: 'none', background: '#eff6ff', padding: '.35rem .9rem', borderRadius: 6 }}
          >
            🔍 Já enviou? Acompanhe sua solicitação
          </a>
          <div>
            Powered by <strong>DespachaApp</strong>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Estilos inline (não depende do CSS global da app) ────────────────────────
const styles = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: '1.5rem 1rem 3rem',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    width: '100%',
    maxWidth: 480,
    boxShadow: '0 20px 60px rgba(0,0,0,.25)',
    overflow: 'hidden',
  },
  header: {
    background: 'linear-gradient(135deg, #1e3a5f, #2563eb)',
    color: '#fff',
    padding: '1.5rem',
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  headerIcon: {
    fontSize: '2rem',
    background: 'rgba(255,255,255,.15)',
    borderRadius: 12,
    width: 52,
    height: 52,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerTitle: {
    margin: 0,
    fontSize: '1.2rem',
    fontWeight: 800,
    letterSpacing: '.02em',
  },
  headerSub: {
    margin: '.25rem 0 0',
    fontSize: '.8rem',
    opacity: .85,
    lineHeight: 1.4,
  },
  field: {
    marginBottom: '1rem',
  },
  label: {
    display: 'block',
    fontSize: '.7rem',
    fontWeight: 700,
    color: '#6b7280',
    letterSpacing: '.08em',
    marginBottom: '.35rem',
  },
  input: {
    width: '100%',
    padding: '.7rem .9rem',
    border: '1.5px solid #e5e7eb',
    borderRadius: 8,
    fontSize: '.95rem',
    color: '#1a1a2e',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color .2s',
    background: '#fafafa',
  },
  btnPhoto: {
    width: '100%',
    padding: '.75rem',
    border: '2px dashed #d1d5db',
    borderRadius: 8,
    background: '#f9fafb',
    color: '#4b5563',
    fontSize: '.9rem',
    cursor: 'pointer',
    textAlign: 'center',
  },
  btnSubmit: {
    width: '100%',
    padding: '.9rem',
    background: 'linear-gradient(135deg, #1e3a5f, #2563eb)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: '1rem',
    fontWeight: 800,
    cursor: 'pointer',
    letterSpacing: '.04em',
    marginTop: '.5rem',
  },
  btnSecondary: {
    padding: '.65rem 2rem',
    background: '#f3f4f6',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: '.9rem',
    fontWeight: 600,
    color: '#374151',
    marginTop: '1rem',
  },
  errorBox: {
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    color: '#dc2626',
    borderRadius: 8,
    padding: '.65rem .9rem',
    fontSize: '.85rem',
    marginBottom: '.75rem',
  },
  protocolBox: {
    background: '#eff6ff',
    border: '2px solid #bfdbfe',
    borderRadius: 12,
    padding: '1.25rem',
    display: 'inline-block',
    minWidth: 180,
  },
  footer: {
    textAlign: 'center',
    padding: '.75rem',
    fontSize: '.72rem',
    color: '#9ca3af',
    borderTop: '1px solid #f3f4f6',
  },
}
