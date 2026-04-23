import { useState, useEffect } from 'react'
import { supabase, toEmail } from '../lib/supabase.js'

// Username do bot centralizado (configure VITE_BOT_USERNAME no Vercel)
const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME || 'despachaapp'

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
  { id: 'providers', label: '👤 Prestadores' },
  { id: 'sla',       label: '⏱ SLA' },
  { id: 'sectors',   label: '🏢 Setores' },
  { id: 'users',     label: '👥 Usuários' },
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
    await supabase.from('config').upsert({ key: 'company_name', value: cfg.company_name || '' })
    setSaving(false)
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
        <div className="cfg-title">🤖 Como os prestadores usam o bot</div>
        <div className="setup-steps">

          <div className="setup-step">
            <div className="step-num">1</div>
            <div className="step-body">
              <div className="step-title">Cadastre seus prestadores</div>
              <div className="step-desc">
                Vá na aba <strong>👤 Prestadores</strong> e adicione cada prestador com o nome que ele usará.
                O nome é usado para identificá-lo automaticamente no Telegram.
              </div>
            </div>
          </div>

          <div className="setup-step">
            <div className="step-num">2</div>
            <div className="step-body">
              <div className="step-title">Compartilhe o código de vinculação</div>
              <div className="step-desc">
                Envie o comando abaixo para cada prestador pelo WhatsApp ou Telegram.
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
                      O prestador clica no link → Telegram abre → já fica vinculado automaticamente.
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
                Sempre que uma tarefa for atribuída ao prestador, ele recebe uma notificação no Telegram.
                Ele pode ver detalhes, atualizar status e enviar fotos direto pelo bot.
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Status dos prestadores */}
      <div className="cfg-card">
        <div className="cfg-title">📊 Status dos Prestadores</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          <StatusRow ok={linked > 0}    label={`${linked} prestador(es) vinculado(s) ao Telegram`} />
          <StatusRow ok={unlinked === 0} label={unlinked === 0 ? 'Todos os prestadores vinculados' : `${unlinked} prestador(es) ainda não vinculado(s)`} />
          <StatusRow ok={!!(cfg.company_name)} label="Nome da empresa configurado" />
        </div>
        {unlinked > 0 && (
          <div style={{ marginTop: '.75rem', fontSize: '.78rem', color: 'var(--muted)' }}>
            ⚠ Prestadores não vinculados: {providers.filter(p => !p.chat_id).map(p => p.name).join(', ')}
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

  function openNew()  { setEditing(null); setF({ name: '', sector: '', active: 1, chat_id: '' }); setModal(true) }
  function openEdit(p) { setEditing(p); setF({ name: p.name, sector: p.sector || '', active: p.active, chat_id: p.chat_id || '' }); setModal(true) }

  async function save() {
    if (!f.name.trim()) return alert('Nome obrigatório')
    const payload = { name: f.name, sector: f.sector, active: f.active, chat_id: f.chat_id }
    if (editing) await supabase.from('providers').update(payload).eq('id', editing.id)
    else         await supabase.from('providers').insert(payload)
    showToast(editing ? 'Prestador atualizado ✓' : 'Prestador criado ✓')
    setModal(false); load()
  }

  async function del(id) {
    if (!confirm('Desativar este prestador? As tarefas vinculadas serão preservadas.')) return
    const { error } = await supabase.from('providers').update({ active: 0 }).eq('id', id)
    if (error) { showToast('Erro: ' + error.message, 'err'); return }
    showToast('Prestador desativado ✓'); load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '.75rem' }}>
        <button className="btn-primary" onClick={openNew}>+ Novo Prestador</button>
      </div>
      <div className="cfg-card">
        {providers.length === 0 ? <div className="empty">Nenhum prestador cadastrado</div> : providers.map(p => (
          <div key={p.id} className="provider-row">
            <div className="provider-avatar">👷</div>
            <div className="provider-info">
              <div className="provider-name">
                {p.name}
                {!p.active && <span style={{ color: 'var(--muted)', fontSize: '.72rem', marginLeft: '.4rem' }}>(inativo)</span>}
              </div>
              <div className={`provider-meta${p.chat_id ? ' chat-linked' : ''}`}>
                {p.sector || 'Sem setor'} {p.chat_id ? ' · 🔗 Telegram vinculado' : ' · ⚠ Não vinculado'}
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
              <span className="mtitle">{editing ? 'EDITAR PRESTADOR' : 'NOVO PRESTADOR'}</span>
              <button className="mclose" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="mbody">
              <div className="fgrid">
                <div className="fg full">
                  <label className="flabel">NOME *</label>
                  <input className="finput" value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} placeholder="Nome exatamente como o prestador usará no Telegram" />
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
                <div className="fg full">
                  <label className="flabel">CHAT ID TELEGRAM</label>
                  <input className="finput" value={f.chat_id} onChange={e => setF(p => ({ ...p, chat_id: e.target.value }))} placeholder="Preenchido automaticamente quando o prestador usa /start no bot" />
                  <span style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: '.25rem' }}>
                    O prestador só precisa abrir o bot no Telegram e digitar /start — o vínculo é automático pelo nome.
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
        Define quantas horas o prestador tem para concluir a tarefa após a abertura.
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
    const { error } = await supabase.from('sectors').insert({ name: newName.trim() })
    if (error) { showToast('Setor já existe', 'err'); return }
    showToast('Setor criado ✓'); setNewName(''); load()
  }

  async function del(id) {
    await supabase.from('sectors').update({ active: 0 }).eq('id', id)
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
function UsersPanel({ showToast, user: currentUser }) {
  const [modal,  setModal]  = useState(false)
  const [saving, setSaving] = useState(false)
  const [f, setF] = useState({ name: '', username: '', password: '', password2: '', role: 'operator' })

  async function createUser() {
    if (!f.name || !f.username || !f.password) return alert('Preencha todos os campos')
    if (f.password !== f.password2) return alert('As senhas não coincidem')
    if (f.password.length < 6) return alert('Senha mínimo 6 caracteres')
    setSaving(true)
    // Herda o company_id do admin que está criando o usuário
    const company_id = currentUser?.company_id
    const { error } = await supabase.auth.signUp({
      email: toEmail(f.username),
      password: f.password,
      options: { data: { name: f.name, username: f.username, role: f.role, company_id } }
    })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'err'); return }
    showToast('Usuário criado ✓')
    setModal(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.75rem' }}>
        <div style={{ fontSize: '.82rem', color: 'var(--muted)' }}>
          Usuário logado: <strong style={{ color: 'var(--text)' }}>{currentUser?.name || currentUser?.username}</strong>
          <span className={`role-badge ${currentUser?.role}`} style={{ marginLeft: '.5rem' }}>{currentUser?.role}</span>
        </div>
        <button className="btn-primary" onClick={() => { setF({ name: '', username: '', password: '', password2: '', role: 'operator' }); setModal(true) }}>
          + Novo Usuário
        </button>
      </div>

      <div className="cfg-card">
        <div className="cfg-title">👥 Gerenciar Usuários</div>
        <div style={{ fontSize: '.82rem', color: 'var(--muted)', lineHeight: 1.7 }}>
          Os usuários fazem login com <strong>nome de usuário + senha</strong>.<br />
          Para ver todos os usuários cadastrados acesse o painel do Supabase → <strong>Authentication → Users</strong>.<br />
          Para redefinir senha de um usuário, acesse o mesmo painel e clique em <strong>Send recovery email</strong>.
        </div>
      </div>

      {modal && (
        <div className="overlay open" onClick={e => e.target.className === 'overlay open' && setModal(false)}>
          <div className="modal" style={{ width: '460px' }}>
            <div className="mhead">
              <span className="mtitle">NOVO USUÁRIO</span>
              <button className="mclose" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="mbody">
              <div className="fgrid">
                <div className="fg full">
                  <label className="flabel">NOME COMPLETO *</label>
                  <input className="finput" value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} placeholder="Ex: João Silva" />
                </div>
                <div className="fg">
                  <label className="flabel">USUÁRIO *</label>
                  <input className="finput" value={f.username} onChange={e => setF(p => ({ ...p, username: e.target.value }))} placeholder="joao.silva" autoComplete="off" />
                </div>
                <div className="fg">
                  <label className="flabel">PERMISSÃO</label>
                  <select className="finput" value={f.role} onChange={e => setF(p => ({ ...p, role: e.target.value }))}>
                    <option value="admin">🔴 Admin</option>
                    <option value="manager">🟠 Gerente</option>
                    <option value="operator">🔵 Operador</option>
                    <option value="viewer">⚪ Visualizador</option>
                  </select>
                </div>
                <div className="fg">
                  <label className="flabel">SENHA *</label>
                  <input className="finput" type="password" value={f.password} onChange={e => setF(p => ({ ...p, password: e.target.value }))} placeholder="Mínimo 6 caracteres" />
                </div>
                <div className="fg">
                  <label className="flabel">CONFIRMAR SENHA</label>
                  <input className="finput" type="password" value={f.password2} onChange={e => setF(p => ({ ...p, password2: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="mfoot">
              <button className="btn-sec" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={createUser} disabled={saving}>{saving ? 'Criando…' : 'CRIAR USUÁRIO'}</button>
            </div>
          </div>
        </div>
      )}
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
      {tab === 'users'     && <UsersPanel      showToast={showToast} user={user} />}
    </div>
  )
}
