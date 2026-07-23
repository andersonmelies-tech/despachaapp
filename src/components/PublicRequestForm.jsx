/**
 * Formulário público de solicitação de serviço
 * Acessado via /solicitar?c=INVITE_CODE
 * Sem autenticação — qualquer pessoa pode abrir chamado
 */
import { useState, useRef, useEffect } from 'react'

// Comprime imagem — 3 estratégias em cascata para máxima compatibilidade mobile
async function compressImage(file, maxPx = 800, quality = 0.65) {
  const isValid = r => r && r !== 'data:,' && r.length > 100

  // Estratégia 1: createImageBitmap (mais confiável, lida com EXIF/HEIC)
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file)
      const s = Math.min(1, maxPx / Math.max(bmp.width, bmp.height))
      const w = Math.ceil(bmp.width * s), h = Math.ceil(bmp.height * s)
      const cv = document.createElement('canvas')
      cv.width = w; cv.height = h
      cv.getContext('2d').drawImage(bmp, 0, 0, w, h)
      bmp.close()
      const r = cv.toDataURL('image/jpeg', quality)
      if (isValid(r)) return r
    } catch {}
  }

  // Estratégia 2: blob URL + img.decode (decode garante pixel data disponível)
  const blobUrl = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = blobUrl
    await (img.decode ? img.decode() : new Promise((res, rej) => { img.onload = res; img.onerror = rej }))
    URL.revokeObjectURL(blobUrl)
    const W = img.naturalWidth || img.width || 0
    const H = img.naturalHeight || img.height || 0
    if (W > 0 && H > 0) {
      const s = Math.min(1, maxPx / Math.max(W, H))
      const cv = document.createElement('canvas')
      cv.width = Math.ceil(W * s); cv.height = Math.ceil(H * s)
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
      const r = cv.toDataURL('image/jpeg', quality)
      if (isValid(r)) return r
    }
  } catch { URL.revokeObjectURL(blobUrl) }

  // Estratégia 3: FileReader puro (sem compressão — último recurso)
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = e => {
      const r = e.target?.result || null
      // Descarta se > 3MB base64 (evita estouro no body da API)
      resolve(r && r.length < 3_000_000 ? r : null)
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

export default function PublicRequestForm() {
  const params     = new URLSearchParams(window.location.search)
  const inviteCode = params.get('c') || ''

  const [f, setF] = useState({ name: '', phone: '', requester_sector: '', location: '', category: '', description: '' })
  const [photos,    setPhotos]  = useState([])
  const [sending,   setSending] = useState(false)
  const [done,      setDone]    = useState(null)  // { protocol, phone }
  const [error,     setError]   = useState('')
  const [copied,    setCopied]  = useState(false)
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
    const valid = compressed.filter(b => b && b.length > 50 && b !== 'data:,')
    setPhotos(p => [...p, ...valid].slice(0, 3))
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

    if (!locationValue) return setError('Selecione ou informe o local/setor do problema.')

    setSending(true)
    try {
      const res = await fetch('/api/public/request', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:             f.name.trim(),
          phone:            f.phone.trim(),
          requester_sector: f.requester_sector?.trim() || null,
          location:         locationValue,
          category:         f.category?.trim() || null,
          description:      f.description.trim(),
          photos:           photos.length ? photos : null,
          invite_code:      inviteCode,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar')
      setDone({ protocol: data.protocol, phone: f.phone.trim() })
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  // ── Tela de sucesso ──────────────────────────────────────────────────────────
  if (done) {
    const protocolStr  = String(done.protocol).padStart(5, '0')
    const trackingUrl  = `${window.location.origin}/acompanhar?p=${done.protocol}${inviteCode ? '&c=' + inviteCode : ''}`
    const waPhone      = done.phone.replace(/\D/g, '').replace(/^0/, '')
    const waNumber     = waPhone.startsWith('55') ? waPhone : `55${waPhone}`
    const waMsg        = encodeURIComponent(
      `✅ Sua solicitação foi registrada!\n\n🔢 Protocolo: *#${protocolStr}*\n\n🔍 Acompanhe o status pelo link:\n${trackingUrl}`
    )
    const waUrl = `https://wa.me/${waNumber}?text=${waMsg}`

    function copyLink() {
      navigator.clipboard.writeText(trackingUrl).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      })
    }

    return (
      <div style={{ ...styles.page, background: `linear-gradient(135deg, ${colorDark} 0%, ${color} 100%)` }}>
        {brand.logo_url && (
          <div style={{ width:'100%', maxWidth:480, marginBottom:'1.25rem', marginTop:'1rem', textAlign:'center' }}>
            <img src={brand.logo_url} alt={brand.company_name || 'Logo'}
              style={{ maxHeight:70, maxWidth:280, objectFit:'contain', filter:'drop-shadow(0 3px 14px rgba(0,0,0,.45))' }} />
          </div>
        )}
        <div style={styles.card}>
          {/* Header */}
          <div style={{ background:`linear-gradient(135deg, ${colorDark}, ${color})`, padding:'1.5rem', textAlign:'center' }}>
            <div style={{ fontSize:'3rem', marginBottom:'.5rem' }}>✅</div>
            <h2 style={{ margin:0, fontSize:'1.2rem', fontWeight:800, color:'#fff' }}>Solicitação enviada!</h2>
            <p style={{ margin:'.4rem 0 0', fontSize:'.82rem', color:'rgba(255,255,255,.8)' }}>
              Nossa equipe já foi notificada e irá atender em breve.
            </p>
          </div>

          <div style={{ padding:'1.5rem' }}>
            {/* Protocolo */}
            <div style={{ textAlign:'center', marginBottom:'1.5rem' }}>
              <div style={{ fontSize:'.7rem', fontWeight:700, color:'#9ca3af', letterSpacing:'.1em', textTransform:'uppercase', marginBottom:'.5rem' }}>
                Número do protocolo
              </div>
              <div style={{
                display:'inline-block', background:'#eff6ff', border:'2px solid #bfdbfe',
                borderRadius:14, padding:'1rem 2rem',
              }}>
                <div style={{ fontSize:'2.2rem', fontWeight:900, fontFamily:'monospace', color:color, letterSpacing:'.05em' }}>
                  #{protocolStr}
                </div>
              </div>
              <div style={{ fontSize:'.75rem', color:'#9ca3af', marginTop:'.6rem' }}>
                Guarde este número para consultar o status do atendimento.
              </div>
            </div>

            {/* Ações */}
            <div style={{ display:'flex', flexDirection:'column', gap:'.75rem' }}>

              {/* WhatsApp */}
              <a href={waUrl} target="_blank" rel="noreferrer" style={{
                display:'flex', alignItems:'center', justifyContent:'center', gap:'.6rem',
                padding:'.85rem', borderRadius:10, textDecoration:'none',
                background:'#25d366', color:'#fff', fontWeight:700, fontSize:'.95rem',
                boxShadow:'0 4px 14px rgba(37,211,102,.35)',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Enviar protocolo pelo WhatsApp
              </a>

              {/* Copiar link */}
              <button onClick={copyLink} style={{
                display:'flex', alignItems:'center', justifyContent:'center', gap:'.6rem',
                padding:'.85rem', borderRadius:10, cursor:'pointer',
                border:`2px solid ${copied ? '#10b981' : '#e5e7eb'}`,
                background: copied ? '#ecfdf5' : '#f9fafb',
                color: copied ? '#059669' : '#374151',
                fontWeight:700, fontSize:'.95rem', transition:'all .2s',
              }}>
                {copied
                  ? <><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> Link copiado!</>
                  : <><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar link de acompanhamento</>
                }
              </button>

              {/* Acompanhar agora */}
              <a href={trackingUrl} style={{
                display:'flex', alignItems:'center', justifyContent:'center', gap:'.6rem',
                padding:'.75rem', borderRadius:10, textDecoration:'none',
                background:`linear-gradient(135deg, ${colorDark}, ${color})`,
                color:'#fff', fontWeight:700, fontSize:'.9rem',
                boxShadow:`0 4px 14px ${color}44`,
              }}>
                🔍 Acompanhar agora
              </a>
            </div>

            <button
              style={{ ...styles.btnSecondary, width:'100%', marginTop:'1rem', textAlign:'center' }}
              onClick={() => { setDone(null); setF({ name:'', phone:'', requester_sector:'', location:'', category:'', description:'', locationCustom:'' }); setPhotos([]); setCopied(false) }}
            >
              + Nova solicitação
            </button>
          </div>

          <div style={styles.footer}>Powered by <strong>DespachaApp</strong></div>
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

          {/* Setor do solicitante */}
          <div style={styles.field}>
            <label style={styles.label}>SEU SETOR / DEPARTAMENTO</label>
            {sectors.length > 0 ? (
              <select
                style={{ ...styles.input, cursor: 'pointer', color: f.requester_sector ? '#1a1a2e' : '#9ca3af' }}
                value={f.requester_sector}
                onChange={e => set('requester_sector', e.target.value)}
              >
                <option value="">Selecione seu setor…</option>
                {sectors.map(s => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            ) : (
              <input
                style={styles.input}
                placeholder="Ex: Operações, Administrativo, TI…"
                value={f.requester_sector}
                onChange={e => set('requester_sector', e.target.value)}
              />
            )}
          </div>

          {/* Local / Setor */}
          <div style={styles.field}>
            <label style={styles.label}>LOCAL / SETOR DO PROBLEMA *</label>
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

          {/* Categoria */}
          <div style={styles.field}>
            <label style={styles.label}>TIPO DE SERVIÇO</label>
            <input
              style={styles.input}
              placeholder="Ex: Elétrica, Hidráulica, TI, Limpeza…"
              value={f.category}
              onChange={e => set('category', e.target.value)}
            />
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

          {/* Aviso sobre protocolo */}
          <div style={styles.protocolWarning}>
            <div style={{ fontSize: '1.1rem', marginBottom: '.3rem' }}>📋</div>
            <div>
              <strong>Guarde seu protocolo!</strong>
              <div style={{ marginTop: '.25rem', lineHeight: 1.5 }}>
                Após o envio você receberá um número de protocolo. Você poderá enviá-lo direto para o seu WhatsApp — mas <strong>se não salvar ou anotar, não será possível consultar nem acompanhar o andamento do seu atendimento.</strong>
              </div>
            </div>
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
  protocolWarning: {
    display: 'flex',
    gap: '.65rem',
    alignItems: 'flex-start',
    background: '#fffbeb',
    border: '1.5px solid #fcd34d',
    borderRadius: 10,
    padding: '.85rem 1rem',
    fontSize: '.82rem',
    color: '#92400e',
    marginBottom: '.85rem',
    lineHeight: 1.45,
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
