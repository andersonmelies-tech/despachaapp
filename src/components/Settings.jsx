import { useState, useEffect } from 'react'
import { supabase, toEmail, getCompanyId } from '../lib/supabase.js'
import ApiDocs from './ApiDocs.jsx'

// Username do bot centralizado (configure VITE_BOT_USERNAME no Vercel)
const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME || 'despachaapp_bot'

function makeInviteLink(inviteCode, providerId) {
  const param = providerId ? `${inviteCode}_${providerId}` : inviteCode
  return `https://t.me/${BOT_USERNAME}?start=${param}`
}

function makeWhatsappShare(link, providerName, companyName) {
  const text = providerName
    ? `Olá ${providerName}! 👷\nClique no link abaixo para se vincular ao sistema de tarefas *${companyName || 'DespachaApp'}*:\n${link}`
    : `Clique no link para acessar o bot do *${companyName || 'DespachaApp'}*:\n${link}`
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

const TABS = [
  { id: 'setup',     label: '🚀 Configuração' },
  { id: 'providers', label: '👤 Colaboradores' },
  { id: 'sla',       label: '⏱ SLA' },
  { id: 'sectors',   label: '🏢 Setores' },
  { id: 'users',     label: '👥 Usuários' },
  { id: 'api',       label: '🔌 API / ERP' },
  { id: 'branding',  label: '🎨 White-label' },
  { id: 'fiscal',    label: '🧾 Fiscal / NFS-e' },
]

// ── Setup — modelo de bot centralizado ───────────────────────────────────────
function SetupPanel({ showToast }) {
  const [cfg,     setCfg]     = useState({})
  const [company, setCompany] = useState(null)
  const [saving,  setSaving]  = useState(false)
  const [providers, setProviders] = useState([])

  useEffect(() => {
    supabase.from('config').select('*').then(r => {
      const c = {}; (r.data || []).forEach(x => { c[x.key] = x.value }); setCfg(c)
    })
    supabase.from('companies').select('*').limit(1).single()
      .then(r => { if (r.data) setCompany(r.data) })
    supabase.from('providers').select('*').eq('active', 1)
      .then(r => setProviders(r.data || []))
  }, [])

  function copyLink() {
    if (!company?.invite_code) return
    navigator.clipboard.writeText(makeInviteLink(company.invite_code))
    showToast('Link copiado ✓')
  }

  async function saveName() {
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/company/config', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: [{ key: 'company_name', value: cfg.company_name || '' }] }),
    })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) return showToast('Erro ao salvar: ' + (d.error || res.statusText), 'err')
    showToast('Nome salvo ✓')
  }

  const linked   = providers.filter(p => p.chat_id).length
  const unlinked = providers.filter(p => !p.chat_id).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Nome da empresa */}
      <div className="cfg-card">
        <div className="cfg-title">🏢 Dados da Empresa</div>
        <div style={{ display: 'flex', gap: '.65rem', alignItems: 'flex-end' }}>
          <div className="fg" style={{ flex: 1, margin: 0 }}>
            <label className="flabel">NOME DA EMPRESA</label>
            <input className="finput" placeholder="Ex: Construtora XYZ Ltda"
              value={cfg.company_name || ''}
              onChange={e => setCfg(c => ({ ...c, company_name: e.target.value }))} />
          </div>
          <button className="btn-primary" onClick={saveName} disabled={saving} style={{ flexShrink: 0 }}>
            {saving ? 'Salvando…' : '💾 Salvar'}
          </button>
        </div>
      </div>

      {/* Como funciona */}
      <div className="cfg-card">
        <div className="cfg-title">🤖 Como os colaboradores usam o bot</div>
        <div className="setup-steps">

          <div className="setup-step">
            <div className="step-num">1</div>
            <div className="step-body">
              <div className="step-title">Cadastre seus colaboradores</div>
              <div className="step-desc">
                Vá na aba <strong>👤 Colaboradores</strong> e adicione cada colaborador com o nome que ele usará.
                O nome é usado para identificá-lo automaticamente no Telegram.
              </div>
            </div>
          </div>

          <div className="setup-step">
            <div className="step-num">2</div>
            <div className="step-body">
              <div className="step-title">Compartilhe o código de vinculação</div>
              <div className="step-desc">
                Envie o comando abaixo para cada colaborador pelo WhatsApp ou Telegram.
                Ele só precisa abrir o bot e enviar esse comando — pronto.
              </div>
              {company?.invite_code ? (() => {
                const link = makeInviteLink(company.invite_code)
                const waLink = makeWhatsappShare(link, null, cfg.company_name)
                return (
                  <div className="invite-code-box">
                    <div className="invite-code-label">Link de acesso ao bot (geral da empresa):</div>
                    <div className="invite-code-row">
                      <code className="invite-code-val">{link}</code>
                      <button className="invite-code-copy" onClick={copyLink} title="Copiar">⎘ Copiar</button>
                    </div>
                    <div className="invite-share-btns">
                      <a className="invite-share-btn wa" href={waLink} target="_blank" rel="noopener noreferrer">
                        <span>📱</span> Compartilhar no WhatsApp
                      </a>
                      <a className="invite-share-btn tg" href={link} target="_blank" rel="noopener noreferrer">
                        <span>✈️</span> Abrir no Telegram
                      </a>
                    </div>
                    <div className="invite-code-hint">
                      O colaborador clica no link → Telegram abre → já fica vinculado automaticamente.
                      Nenhuma digitação necessária.
                    </div>
                  </div>
                )
              })() : (
                <div style={{ marginTop: '.5rem', fontSize: '.78rem', color: 'var(--muted)' }}>⏳ Carregando…</div>
              )}
            </div>
          </div>

          <div className="setup-step">
            <div className="step-num">3</div>
            <div className="step-body">
              <div className="step-title">Pronto — o bot funciona automaticamente</div>
              <div className="step-desc">
                Sempre que uma tarefa for atribuída ao colaborador, ele recebe uma notificação no Telegram.
                Ele pode ver detalhes, atualizar status e enviar fotos direto pelo bot.
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Status dos prestadores */}
      <div className="cfg-card">
        <div className="cfg-title">📊 Status dos Colaboradores</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          <StatusRow ok={linked > 0}    label={`${linked} colaborador(es) vinculado(s) ao Telegram`} />
          <StatusRow ok={unlinked === 0} label={unlinked === 0 ? 'Todos os colaboradores vinculados' : `${unlinked} colaborador(es) ainda não vinculado(s)`} />
          <StatusRow ok={!!(cfg.company_name)} label="Nome da empresa configurado" />
        </div>
        {unlinked > 0 && (
          <div style={{ marginTop: '.75rem', fontSize: '.78rem', color: 'var(--muted)' }}>
            ⚠ Colaboradores não vinculados: {providers.filter(p => !p.chat_id).map(p => p.name).join(', ')}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusRow({ ok, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', fontSize: '.85rem' }}>
      <span style={{ fontSize: '1rem' }}>{ok ? '✅' : '⬜'}</span>
      <span style={{ color: ok ? 'var(--text)' : 'var(--muted)' }}>{label}</span>
    </div>
  )
}

// ── Providers ──────────────────────────────────────────────────────────────
function ProvidersPanel({ showToast }) {
  const [providers, setProviders] = useState([])
  const [sectors,   setSectors]   = useState([])
  const [company,   setCompany]   = useState(null)
  const [modal,     setModal]     = useState(false)
  const [editing,   setEditing]   = useState(null)
  const [f, setF] = useState({ name: '', sector: '', active: 1, chat_id: '' })

  async function load() {
    const [pr, sr, co] = await Promise.all([
      supabase.from('providers').select('*').order('name'),
      supabase.from('sectors').select('*').eq('active', 1).order('name'),
      supabase.from('companies').select('*').limit(1).single(),
    ])
    setProviders(pr.data || [])
    setSectors(sr.data || [])
    if (co.data) setCompany(co.data)
  }
  useEffect(() => { load() }, [])

  function sendInvite(p) {
    if (!company?.invite_code) { showToast('Carregando dados…'); return }
    const link  = makeInviteLink(company.invite_code, p.id)
    const waUrl = makeWhatsappShare(link, p.name, company.name)
    window.open(waUrl, '_blank')
  }

  function copyInvite(p) {
    if (!company?.invite_code) return
    navigator.clipboard.writeText(makeInviteLink(company.invite_code, p.id))
    showToast(`Link de ${p.name} copiado ✓`)
  }

  function openNew()  { setEditing(null); setF({ name: '', sector: '', active: 1, chat_id: '', is_third_party: false, payment_rate: '' }); setModal(true) }
  function openEdit(p) { setEditing(p); setF({ name: p.name, sector: p.sector || '', active: p.active, chat_id: p.chat_id || '', is_third_party: p.is_third_party || false, payment_rate: p.payment_rate || '' }); setModal(true) }

  async function save() {
    if (!f.name.trim()) return alert('Nome obrigatório')
    const payload = { name: f.name, sector: f.sector, active: f.active, chat_id: f.chat_id, is_third_party: f.is_third_party, payment_rate: f.payment_rate ? Number(f.payment_rate) : null }
    if (editing) await supabase.from('providers').update(payload).eq('id', editing.id)
    else         await supabase.from('providers').insert(payload)
    showToast(editing ? 'Colaborador atualizado ✓' : 'Colaborador criado ✓')
    setModal(false); load()
  }

  async function del(id) {
    if (!confirm('Desativar este colaborador? As tarefas vinculadas serão preservadas.')) return
    const { error } = await supabase.from('providers').update({ active: 0 }).eq('id', id)
    if (error) { showToast('Erro: ' + error.message, 'err'); return }
    showToast('Colaborador desativado ✓'); load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '.75rem' }}>
        <button className="btn-primary" onClick={openNew}>+ Novo Colaborador</button>
      </div>
      <div className="cfg-card">
        {providers.length === 0 ? <div className="empty">Nenhum colaborador cadastrado</div> : providers.map(p => (
          <div key={p.id} className="provider-row">
            <div className="provider-avatar">👷</div>
            <div className="provider-info">
              <div className="provider-name">
                {p.name}
                {!p.active && <span style={{ color: 'var(--muted)', fontSize: '.72rem', marginLeft: '.4rem' }}>(inativo)</span>}
              </div>
              <div className={`provider-meta${p.chat_id ? ' chat-linked' : ''}`}>
                {p.sector || 'Sem setor'} {p.chat_id ? ' · 🔗 Telegram vinculado' : ' · ⚠ Não vinculado'}{p.is_third_party && <span style={{ marginLeft: '.4rem', fontSize: '.7rem', color: 'var(--warn)' }}>🔧 Terceirizado</span>}
              </div>
            </div>
            <div className="actions" style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }}>
              {!p.chat_id && (
                <>
                  <button className="abtn invite-wa" title="Enviar convite pelo WhatsApp" onClick={() => sendInvite(p)}>📱</button>
                  <button className="abtn invite-cp" title="Copiar link de convite" onClick={() => copyInvite(p)}>🔗</button>
                </>
              )}
              <button className="abtn" onClick={() => openEdit(p)}>✏</button>
              <button className="abtn r" onClick={() => del(p.id)}>🗑</button>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="overlay open" onClick={e => e.target.className === 'overlay open' && setModal(false)}>
          <div className="modal">
            <div className="mhead">
              <span className="mtitle">{editing ? 'EDITAR COLABORADOR' : 'NOVO COLABORADOR'}</span>
              <button className="mclose" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="mbody">
              <div className="fgrid">
                <div className="fg full">
                  <label className="flabel">NOME *</label>
                  <input className="finput" value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} placeholder="Nome exatamente como o colaborador usará no Telegram" />
                </div>
                <div className="fg">
                  <label className="flabel">SETOR</label>
                  <select className="finput" value={f.sector} onChange={e => setF(p => ({ ...p, sector: e.target.value }))}>
                    <option value="">Selecione...</option>
                    {sectors.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label className="flabel">STATUS</label>
                  <select className="finput" value={f.active} onChange={e => setF(p => ({ ...p, active: Number(e.target.value) }))}>
                    <option value={1}>✅ Ativo</option>
                    <option value={0}>❌ Inativo</option>
                  </select>
                </div>
                <div className="fg">
                  <label className="flabel">TIPO</label>
                  <select className="finput" value={f.is_third_party ? '1' : '0'} onChange={e => setF(p => ({ ...p, is_third_party: e.target.value === '1' }))}>
                    <option value="0">👤 Colaborador interno</option>
                    <option value="1">🔧 Terceirizado</option>
                  </select>
                </div>
                <div className="fg">
                  <label className="flabel">VALOR POR SERVIÇO (R$)</label>
                  <input className="finput" type="number" min="0" step="0.01" value={f.payment_rate || ''} onChange={e => setF(p => ({ ...p, payment_rate: e.target.value }))} placeholder="0,00" />
                </div>
                <div className="fg full">
                  <label className="flabel">CHAT ID TELEGRAM</label>
                  <input className="finput" value={f.chat_id} onChange={e => setF(p => ({ ...p, chat_id: e.target.value }))} placeholder="Preenchido automaticamente quando o colaborador usa /start no bot" />
                  <span style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: '.25rem' }}>
                    O colaborador só precisa abrir o bot no Telegram e digitar /start — o vínculo é automático pelo nome.
                  </span>
                </div>
              </div>
            </div>
            <div className="mfoot">
              <button className="btn-sec" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={save}>SALVAR</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── SLA ────────────────────────────────────────────────────────────────────
function SLAPanel({ showToast }) {
  const [rows, setRows] = useState([])
  useEffect(() => { supabase.from('sla_config').select('*').then(r => setRows(r.data || [])) }, [])

  async function save(row) {
    await supabase.from('sla_config').upsert({ urgency: row.urgency, hours: Number(row.hours), label: row.label })
    showToast('SLA atualizado ✓')
  }
  function update(urgency, key, val) {
    setRows(rs => rs.map(r => r.urgency === urgency ? { ...r, [key]: val } : r))
  }

  return (
    <div className="cfg-card">
      <div className="cfg-title">⏱ Prazo de conclusão por urgência</div>
      <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: '1rem' }}>
        Define quantas horas o colaborador tem para concluir a tarefa após a abertura.
      </div>
      {rows.map(row => (
        <div key={row.urgency} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.6rem 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <span className={`ubadge ${row.urgency}`} style={{ width: '80px', justifyContent: 'center' }}>{row.urgency}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
            <input className="finput" style={{ width: '70px' }} type="number" min="1" value={row.hours} onChange={e => update(row.urgency, 'hours', e.target.value)} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--muted)' }}>horas</span>
          </div>
          <input className="finput" style={{ flex: 1, minWidth: '120px' }} value={row.label || ''} onChange={e => update(row.urgency, 'label', e.target.value)} placeholder="Rótulo (opcional)" />
          <button className="btn-sec" onClick={() => save(row)}>Salvar</button>
        </div>
      ))}
    </div>
  )
}

// ── Sectors ────────────────────────────────────────────────────────────────
function SectorsPanel({ showToast }) {
  const [sectors, setSectors] = useState([])
  const [newName, setNewName] = useState('')

  async function load() { supabase.from('sectors').select('*').eq('active', 1).order('name').then(r => setSectors(r.data || [])) }
  useEffect(() => { load() }, [])

  async function add() {
    if (!newName.trim()) return
    const nome = newName.trim()
    if (sectors.some(s => s.name.toLowerCase() === nome.toLowerCase())) {
      showToast('Setor já existe', 'err'); return
    }
    const company_id = await getCompanyId()
    const { error } = await supabase.from('sectors').insert({ name: nome, company_id })
    if (error) {
      if (error.code === '23505') showToast('Setor já existe', 'err')
      else showToast('Erro: ' + error.message, 'err')
      return
    }
    showToast('Setor criado ✓'); setNewName(''); load()
  }

  async function del(id) {
    const { error } = await supabase.from('sectors').update({ active: 0 }).eq('id', id)
    if (error) { showToast('Erro ao remover: ' + error.message, 'err'); return }
    showToast('Setor removido'); load()
  }

  return (
    <div className="cfg-card">
      <div className="cfg-title">🏢 Setores</div>
      <div style={{ display: 'flex', gap: '.65rem', marginBottom: '1rem' }}>
        <input className="finput" placeholder="Nome do setor…" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} style={{ flex: 1 }} />
        <button className="btn-primary" onClick={add}>+ Adicionar</button>
      </div>
      <div>
        {sectors.map(s => (
          <span key={s.id} className="sector-tag">
            {s.name}
            <button onClick={() => del(s.id)}>✕</button>
          </span>
        ))}
        {sectors.length === 0 && <div className="empty" style={{ padding: '1rem 0' }}>Nenhum setor cadastrado</div>}
      </div>
    </div>
  )
}

// ── Users ──────────────────────────────────────────────────────────────────
const ROLE_LABEL = { admin: 'Admin', manager: 'Gerente', operator: 'Operador', viewer: 'Visualizador' }
const ROLE_COLORS = { admin: 'var(--red)', manager: 'var(--warn)', operator: 'var(--blue)', viewer: 'var(--muted)' }

function UsersPanel({ showToast, user: currentUser, session }) {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [modal,   setModal]   = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [deleting,setDeleting]= useState(null)
  const [f, setF] = useState({ name: '', username: '', password: '', password2: '', role: 'operator' })

  const token = session?.access_token

  async function loadUsers() {
    setLoading(true)
    try {
      const res = await fetch('/api/users/list', { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      setUsers(data.users || [])
    } catch { setUsers([]) }
    setLoading(false)
  }

  async function createUser() {
    if (!f.name.trim())     return showToast('Nome obrigatório', 'err')
    if (!f.username.trim()) return showToast('Usuário obrigatório', 'err')
    if (f.password.length < 6) return showToast('Senha mínimo 6 caracteres', 'err')
    if (f.password !== f.password2) return showToast('As senhas não coincidem', 'err')
    setSaving(true)
    try {
      const res = await fetch('/api/users/create', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name, username: f.username, password: f.password, role: f.role }),
      })
      const data = await res.json()
      if (data.error) { showToast('Erro: ' + data.error, 'err'); setSaving(false); return }
      showToast(`Usuário ${f.name} criado com sucesso ✓`)
      setModal(false)
      setF({ name: '', username: '', password: '', password2: '', role: 'operator' })
      loadUsers()
    } catch (e) { showToast('Erro de conexão', 'err') }
    setSaving(false)
  }

  async function deleteUser(u) {
    if (!confirm(`Remover o usuário "${u.name}"? Esta ação não pode ser desfeita.`)) return
    setDeleting(u.id)
    try {
      const res = await fetch('/api/users/list', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: u.id }),
      })
      const data = await res.json()
      if (data.error) { showToast('Erro: ' + data.error, 'err') }
      else { showToast(`Usuário ${u.name} removido`); loadUsers() }
    } catch { showToast('Erro de conexão', 'err') }
    setDeleting(null)
  }

  useEffect(() => { loadUsers() }, [])

  function fmtDate(d) {
    if (!d) return '–'
    return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '.95rem', fontWeight: 600, color: 'var(--text)' }}>👥 Usuários da empresa</div>
          <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.15rem' }}>
            Usuários que podem acessar o sistema. Login com <strong>usuário + senha</strong>.
          </div>
        </div>
        <button className="btn-primary" onClick={() => { setF({ name: '', username: '', password: '', password2: '', role: 'operator' }); setModal(true) }}>
          + Novo Usuário
        </button>
      </div>

      {/* Lista de usuários */}
      <div className="cfg-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 110px 90px 80px', padding: '.6rem 1rem', background: 'var(--s2)', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', letterSpacing: '.1em', textTransform: 'uppercase' }}>
          <span>Nome</span><span>Usuário</span><span>Permissão</span><span>Cadastro</span><span></span>
        </div>
        {loading ? (
          <div className="empty">Carregando…</div>
        ) : users.length === 0 ? (
          <div className="empty">Nenhum usuário encontrado</div>
        ) : users.map(u => (
          <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 110px 90px 80px', padding: '.75rem 1rem', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: '.88rem' }}>
              {u.name}
              {u.id === currentUser?.sub && <span style={{ fontSize: '.68rem', color: 'var(--blue)', marginLeft: '.4rem' }}>(você)</span>}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.8rem', color: 'var(--muted)' }}>@{u.username}</div>
            <div>
              <span className={`role-badge ${u.role}`}>{ROLE_LABEL[u.role] || u.role}</span>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--muted)' }}>{fmtDate(u.created_at)}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              {u.id !== currentUser?.sub && (
                <button className="abtn r" style={{ fontSize: '.72rem' }} disabled={deleting === u.id}
                  onClick={() => deleteUser(u)}>
                  {deleting === u.id ? '…' : '🗑'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Modal novo usuário */}
      {modal && (
        <div className="overlay open" onClick={e => e.target.className === 'overlay open' && setModal(false)}>
          <div className="modal" style={{ width: '480px' }}>
            <div className="mhead">
              <span className="mtitle">NOVO USUÁRIO</span>
              <button className="mclose" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="mbody">
              <div className="fgrid">
                <div className="fg full">
                  <label className="flabel">NOME COMPLETO *</label>
                  <input className="finput" value={f.name}
                    onChange={e => setF(p => ({ ...p, name: e.target.value }))}
                    placeholder="Ex: João Silva" autoFocus />
                </div>
                <div className="fg">
                  <label className="flabel">USUÁRIO DE LOGIN *</label>
                  <input className="finput" value={f.username}
                    onChange={e => setF(p => ({ ...p, username: e.target.value }))}
                    placeholder="joao.silva" autoComplete="off" />
                </div>
                <div className="fg">
                  <label className="flabel">PERMISSÃO</label>
                  <select className="finput" value={f.role}
                    onChange={e => setF(p => ({ ...p, role: e.target.value }))}>
                    <option value="admin">🔴 Admin — acesso total</option>
                    <option value="manager">🟠 Gerente — gerencia tarefas</option>
                    <option value="operator">🔵 Operador — cria e edita tarefas</option>
                    <option value="viewer">⚪ Visualizador — somente leitura</option>
                  </select>
                </div>
                <div className="fg">
                  <label className="flabel">SENHA *</label>
                  <input className="finput" type="password" value={f.password}
                    onChange={e => setF(p => ({ ...p, password: e.target.value }))}
                    placeholder="Mínimo 6 caracteres" />
                </div>
                <div className="fg">
                  <label className="flabel">CONFIRMAR SENHA *</label>
                  <input className="finput" type="password" value={f.password2}
                    onChange={e => setF(p => ({ ...p, password2: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && createUser()} />
                </div>
              </div>
              <div style={{ marginTop: '1rem', padding: '.75rem', background: 'var(--s2)', borderRadius: 'var(--radius-sm)', fontSize: '.78rem', color: 'var(--muted)' }}>
                💡 O usuário fará login com <strong style={{ color: 'var(--text)' }}>@{f.username || 'usuario'}</strong> e a senha definida acima.
              </div>
            </div>
            <div className="mfoot">
              <button className="btn-sec" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={createUser} disabled={saving}>
                {saving ? 'Criando…' : '✓ Criar Usuário'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Branding ───────────────────────────────────────────────────────────────
function BrandingPanel({ showToast, session }) {
  const [logoUrl,   setLogoUrl]   = useState('')
  const [color,     setColor]     = useState('#3B82F6')
  const [email,     setEmail]     = useState('')
  const [saving,    setSaving]    = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (!session?.access_token) return
    fetch('/api/branding/upload', {
      headers: { Authorization: `Bearer ${session.access_token}` }
    }).then(r => r.json()).then(c => {
      if (c.brand_logo_url)      setLogoUrl(c.brand_logo_url)
      if (c.brand_primary_color) setColor(c.brand_primary_color)
      if (c.report_email)        setEmail(c.report_email)
    }).catch(() => {})
  }, [session])

  async function uploadLogo(e) {
    const file = e.target.files[0]; if (!file) return
    setUploading(true)
    const form = new FormData(); form.append('file', file)
    const res = await fetch('/api/branding/upload', {
      method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` }, body: form
    })
    const d = await res.json()
    if (d.url) { setLogoUrl(d.url); showToast('Logo atualizada ✓') }
    else showToast('Erro ao fazer upload: ' + (d.error || 'desconhecido'), 'err')
    setUploading(false)
  }

  async function saveSettings() {
    setSaving(true)
    const res = await fetch('/api/branding/upload', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand_primary_color: color, report_email: email }),
    })
    const d = await res.json()
    if (!d.ok) { showToast('Erro ao salvar', 'err'); setSaving(false); return }
    document.documentElement.style.setProperty('--blue', color)
    showToast('Configurações salvas ✓')
    setSaving(false)
  }

  const colorDark = '#1e3a5f'
  const PRESETS = ['#2563eb','#7c3aed','#059669','#dc2626','#d97706','#0891b2','#be185d','#1e3a5f']

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'1.25rem' }}>

      {/* ── Cabeçalho da seção ── */}
      <div style={{ borderBottom:'1px solid var(--border)', paddingBottom:'1rem' }}>
        <h2 style={{ margin:0, fontSize:'1rem', fontWeight:700, color:'var(--text)' }}>Identidade Visual</h2>
        <p style={{ margin:'.25rem 0 0', fontSize:'.82rem', color:'var(--muted)' }}>
          Personalize os formulários públicos com a marca da sua empresa.
        </p>
      </div>

      {/* ── Grid principal: esquerda = controles, direita = preview ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 340px', gap:'1.25rem', alignItems:'start' }}>

        {/* Coluna esquerda — controles */}
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>

          {/* Logo */}
          <div className="cfg-card" style={{ padding:'1.25rem' }}>
            <div style={{ fontSize:'.7rem', fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--muted)', marginBottom:'.75rem' }}>
              Logo da Empresa
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:'1.25rem' }}>
              {/* Preview da logo */}
              <div style={{
                width:96, height:72, borderRadius:10, border:'1.5px dashed var(--border)',
                background:'var(--s2)', display:'flex', alignItems:'center', justifyContent:'center',
                overflow:'hidden', flexShrink:0,
              }}>
                {logoUrl
                  ? <img src={logoUrl} alt="Logo" style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain', padding:4 }} />
                  : <span style={{ fontSize:'1.6rem', opacity:.4 }}>🏢</span>
                }
              </div>
              <div style={{ flex:1 }}>
                <label style={{
                  display:'inline-flex', alignItems:'center', gap:'.5rem',
                  padding:'.5rem 1rem', borderRadius:7, cursor:'pointer',
                  border:'1.5px solid var(--border)', background:'var(--s1)',
                  fontSize:'.85rem', fontWeight:600, color:'var(--text)',
                  transition:'all .15s',
                }}>
                  {uploading
                    ? <><span style={{ display:'inline-block', width:14, height:14, border:'2px solid var(--muted)', borderTopColor:'var(--blue)', borderRadius:'50%', animation:'spin .7s linear infinite' }} /> Enviando…</>
                    : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Selecionar arquivo</>
                  }
                  <input type="file" accept="image/*,.svg" style={{ display:'none' }} onChange={uploadLogo} disabled={uploading} />
                </label>
                <div style={{ marginTop:'.5rem', fontSize:'.73rem', color:'var(--muted)', lineHeight:1.5 }}>
                  PNG, SVG ou WebP · Fundo transparente recomendado · mín. 200×200 px
                </div>
                {logoUrl && (
                  <button onClick={() => setLogoUrl('')} style={{
                    marginTop:'.4rem', background:'none', border:'none', cursor:'pointer',
                    fontSize:'.73rem', color:'#ef4444', padding:0,
                  }}>Remover logo</button>
                )}
              </div>
            </div>
          </div>

          {/* Cor principal */}
          <div className="cfg-card" style={{ padding:'1.25rem' }}>
            <div style={{ fontSize:'.7rem', fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--muted)', marginBottom:'.75rem' }}>
              Cor Principal
            </div>
            {/* Presets */}
            <div style={{ display:'flex', gap:'.5rem', marginBottom:'.85rem', flexWrap:'wrap' }}>
              {PRESETS.map(c => (
                <button key={c} onClick={() => setColor(c)} style={{
                  width:28, height:28, borderRadius:6, background:c, border:'none', cursor:'pointer',
                  boxShadow: color === c ? `0 0 0 2px var(--bg), 0 0 0 4px ${c}` : 'none',
                  transition:'box-shadow .15s', flexShrink:0,
                }} />
              ))}
            </div>
            {/* Picker + hex */}
            <div style={{ display:'flex', alignItems:'center', gap:'.75rem' }}>
              <div style={{ position:'relative' }}>
                <input type="color" value={color} onChange={e => setColor(e.target.value)}
                  style={{ width:44, height:44, borderRadius:8, border:'1.5px solid var(--border)', cursor:'pointer', padding:2, background:'var(--s1)' }} />
              </div>
              <div style={{ flex:1 }}>
                <input
                  value={color}
                  onChange={e => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) setColor(e.target.value) }}
                  style={{
                    width:'100%', padding:'.45rem .7rem', borderRadius:7,
                    border:'1.5px solid var(--border)', background:'var(--s2)',
                    color:'var(--text)', fontSize:'.9rem', fontFamily:'monospace', fontWeight:600,
                    boxSizing:'border-box',
                  }}
                />
              </div>
              <div style={{
                padding:'.4rem 1rem', borderRadius:7, background:color,
                color:'#fff', fontSize:'.8rem', fontWeight:600,
                boxShadow:`0 4px 14px ${color}55`, whiteSpace:'nowrap',
              }}>
                Botão exemplo
              </div>
            </div>
          </div>

          {/* E-mail */}
          <div className="cfg-card" style={{ padding:'1.25rem' }}>
            <div style={{ fontSize:'.7rem', fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--muted)', marginBottom:'.75rem' }}>
              Relatório Semanal por E-mail
            </div>
            <input className="finput" type="email" placeholder="gerencia@suaempresa.com.br"
              value={email} onChange={e => setEmail(e.target.value)} style={{ width:'100%', boxSizing:'border-box' }} />
            <div style={{ marginTop:'.5rem', fontSize:'.73rem', color:'var(--muted)' }}>
              Toda segunda-feira às 8h você recebe um resumo com os dados da semana anterior.
            </div>
          </div>

          {/* Botão salvar */}
          <div style={{ display:'flex', gap:'.75rem', alignItems:'center' }}>
            <button onClick={saveSettings} disabled={saving} style={{
              padding:'.6rem 1.5rem', borderRadius:8, border:'none', cursor:'pointer',
              background: saving ? 'var(--s2)' : `linear-gradient(135deg, ${colorDark}, ${color})`,
              color:'#fff', fontSize:'.9rem', fontWeight:700,
              boxShadow: saving ? 'none' : `0 4px 14px ${color}44`,
              transition:'all .2s', opacity: saving ? .7 : 1,
            }}>
              {saving ? 'Salvando…' : 'Salvar alterações'}
            </button>
          </div>
        </div>

        {/* Coluna direita — preview do portal */}
        <div style={{ position:'sticky', top:'1rem' }}>
          <div style={{ fontSize:'.7rem', fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--muted)', marginBottom:'.75rem' }}>
            Preview — Formulário Público
          </div>
          <div style={{
            borderRadius:12, overflow:'hidden', border:'1px solid var(--border)',
            boxShadow:'0 8px 32px rgba(0,0,0,.25)', background:'#f9fafb',
          }}>
            {/* Header do formulário */}
            <div style={{
              background:`linear-gradient(135deg, ${colorDark}, ${color})`,
              padding:'1rem', display:'flex', alignItems:'center', gap:'.75rem',
            }}>
              {logoUrl
                ? <img src={logoUrl} alt="Logo" style={{ height:36, maxWidth:100, objectFit:'contain', filter:'drop-shadow(0 2px 6px rgba(0,0,0,.3))' }} />
                : <div style={{ width:36, height:36, borderRadius:8, background:'rgba(255,255,255,.2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.1rem' }}>🏢</div>
              }
              <div>
                <div style={{ color:'#fff', fontWeight:700, fontSize:'.85rem' }}>Nova Solicitação</div>
                <div style={{ color:'rgba(255,255,255,.75)', fontSize:'.7rem' }}>Preencha os campos abaixo</div>
              </div>
            </div>
            {/* Corpo do formulário */}
            <div style={{ padding:'1rem', display:'flex', flexDirection:'column', gap:'.6rem' }}>
              {['Título da solicitação', 'Local / Setor', 'Descrição'].map((lbl, i) => (
                <div key={i}>
                  <div style={{ fontSize:'.65rem', fontWeight:600, color:'#6b7280', marginBottom:'.25rem' }}>{lbl}</div>
                  <div style={{ height: i === 2 ? 40 : 28, borderRadius:6, background:'#fff', border:'1.5px solid #e5e7eb' }} />
                </div>
              ))}
              <div style={{
                marginTop:'.25rem', padding:'.5rem', borderRadius:7, textAlign:'center',
                background:`linear-gradient(135deg, ${colorDark}, ${color})`,
                color:'#fff', fontSize:'.75rem', fontWeight:700,
                boxShadow:`0 3px 10px ${color}44`,
              }}>
                Enviar Solicitação
              </div>
            </div>
            <div style={{ textAlign:'center', padding:'.5rem', borderTop:'1px solid #e5e7eb', fontSize:'.65rem', color:'#9ca3af' }}>
              Powered by <strong>DespachaApp</strong>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Fiscal / NFS-e ─────────────────────────────────────────────────────────
function FiscalPanel({ showToast }) {
  const FIELDS = [
    { key: 'nfse_token',               label: 'Token Focus NFe *',              placeholder: 'Gerado no painel Focus NFe', type: 'password' },
    { key: 'nfse_ambiente',            label: 'Ambiente',                       placeholder: '', type: 'select', options: ['homologacao', 'producao'] },
    { key: 'nfse_cnpj',               label: 'CNPJ da empresa (somente números)', placeholder: '00000000000000' },
    { key: 'nfse_razao_social',        label: 'Razão Social',                   placeholder: 'Ex: Empresa XYZ Ltda' },
    { key: 'nfse_inscricao_municipal', label: 'Inscrição Municipal',            placeholder: 'Número fornecido pela prefeitura' },
    { key: 'nfse_codigo_municipio',    label: 'Código IBGE do Município',       placeholder: 'Ex: 3550308 (São Paulo)' },
    { key: 'nfse_codigo_servico',      label: 'Código do Serviço (LC 116)',     placeholder: 'Ex: 17.05' },
    { key: 'nfse_aliquota',            label: 'Alíquota ISS (decimal)',         placeholder: 'Ex: 0.05 para 5%' },
    { key: 'nfse_discriminacao',       label: 'Discriminação padrão',           placeholder: 'Texto padrão que aparece na NFS-e' },
  ]

  const [vals, setVals] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('config').select('key, value')
      .in('key', FIELDS.map(f => f.key))
      .then(r => {
        const c = {}; (r.data || []).forEach(x => { c[x.key] = x.value })
        setVals(c)
      })
  }, [])

  async function save() {
    setSaving(true)
    const updates = FIELDS
      .filter(f => vals[f.key] !== undefined && vals[f.key] !== '')
      .map(f => ({ key: f.key, value: vals[f.key] }))
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/company/config', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) return showToast('Erro ao salvar: ' + (d.error || res.statusText), 'err')
    showToast('Configurações fiscais salvas ✓')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="cfg-card">
        <div className="cfg-title">🧾 Configuração NFS-e — Focus NFe</div>
        <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: '1.25rem', lineHeight: 1.6 }}>
          Integração com a API <a href="https://focusnfe.com.br" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)' }}>Focus NFe</a> para emissão automática de Nota Fiscal de Serviço Eletrônica.
          O token é gerado no painel do Focus NFe após criar sua conta.
        </div>

        <div className="fgrid">
          {FIELDS.map(f => (
            <div key={f.key} className={f.key === 'nfse_discriminacao' ? 'fg full' : 'fg'}>
              <label className="flabel">{f.label.toUpperCase()}</label>
              {f.type === 'select' ? (
                <select className="finput" value={vals[f.key] || 'homologacao'}
                  onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))}>
                  {f.options.map(o => (
                    <option key={o} value={o}>{o === 'homologacao' ? '🔧 Homologação (testes)' : '🚀 Produção (real)'}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="finput"
                  type={f.type || 'text'}
                  value={vals[f.key] || ''}
                  onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  autoComplete="off"
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="cfg-card" style={{ background: 'var(--warn)11', border: '1px solid var(--warn)33' }}>
        <div style={{ fontSize: '.82rem', color: 'var(--warn)', lineHeight: 1.65 }}>
          ⚠ <strong>Atenção:</strong> O ambiente <em>Homologação</em> emite notas de teste (não têm validade fiscal).
          Apenas troque para <em>Produção</em> após validar a integração e se certificar que os dados estão corretos.
          Notas emitidas em produção <strong>não podem ser canceladas</strong> após 24h.
        </div>
      </div>

      <button className="btn-primary" style={{ alignSelf: 'flex-start' }} onClick={save} disabled={saving}>
        {saving ? 'Salvando…' : '💾 Salvar Configurações Fiscais'}
      </button>
    </div>
  )
}

// ── Settings (main) ────────────────────────────────────────────────────────
export default function Settings({ showToast, user, session }) {
  const [tab, setTab] = useState('setup')

  return (
    <div>
      <div className="stab-bar">
        {TABS.map(t => (
          <button key={t.id} className={`stab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'setup'     && <SetupPanel     showToast={showToast} />}
      {tab === 'providers' && <ProvidersPanel  showToast={showToast} />}
      {tab === 'sla'       && <SLAPanel        showToast={showToast} />}
      {tab === 'sectors'   && <SectorsPanel    showToast={showToast} />}
      {tab === 'users'     && <UsersPanel      showToast={showToast} user={user} session={session} />}
      {tab === 'api'       && <ApiDocs         showToast={showToast} />}
      {tab === 'branding'  && <BrandingPanel   showToast={showToast} session={session} />}
      {tab === 'fiscal'    && <FiscalPanel     showToast={showToast} />}
    </div>
  )
}
