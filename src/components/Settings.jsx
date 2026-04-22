import { useState, useEffect } from 'react'
import { supabase, toEmail } from '../lib/supabase.js'

const TABS = [
  { id: 'geral',      label: '⚙️ Geral' },
  { id: 'providers',  label: '👤 Prestadores' },
  { id: 'sla',        label: '⏱ SLA' },
  { id: 'sectors',    label: '🏢 Setores' },
  { id: 'users',      label: '👥 Usuários' },
  { id: 'telegram',   label: '🤖 Telegram' },
]

// ── Geral ──────────────────────────────────────────────────────────────────
function GeralPanel({ showToast }) {
  const [cfg, setCfg] = useState({})
  useEffect(() => {
    supabase.from('config').select('*').then(r => {
      const c = {}; (r.data || []).forEach(x => { c[x.key] = x.value }); setCfg(c)
    })
  }, [])
  async function save() {
    for (const [key, value] of Object.entries(cfg)) {
      await supabase.from('config').upsert({ key, value })
    }
    showToast('Configurações salvas ✓')
  }
  return (
    <div className="cfg-card">
      <div className="cfg-title">⚙️ Configurações Gerais</div>
      <div className="fgrid" style={{ gap: '.75rem' }}>
        <div className="fg full">
          <label className="flabel">TOKEN TELEGRAM (global)</label>
          <input className="finput" type="password" placeholder="123456789:AABBcc..." value={cfg.telegram_token || ''} onChange={e => setCfg(c => ({ ...c, telegram_token: e.target.value }))} />
        </div>
      </div>
      <div style={{ marginTop: '1rem' }}>
        <button className="btn-primary" onClick={save}>Salvar</button>
      </div>
    </div>
  )
}

// ── Providers ──────────────────────────────────────────────────────────────
function ProvidersPanel({ showToast }) {
  const [providers, setProviders] = useState([])
  const [sectors, setSectors] = useState([])
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [f, setF] = useState({ name: '', sector: '', active: 1, telegram_token: '', chat_id: '' })

  async function load() {
    const [pr, sr] = await Promise.all([
      supabase.from('providers').select('*').order('name'),
      supabase.from('sectors').select('*').eq('active', 1).order('name'),
    ])
    setProviders(pr.data || [])
    setSectors(sr.data || [])
  }
  useEffect(() => { load() }, [])

  function openNew() { setEditing(null); setF({ name: '', sector: '', active: 1, telegram_token: '', chat_id: '' }); setModal(true) }
  function openEdit(p) { setEditing(p); setF({ name: p.name, sector: p.sector, active: p.active, telegram_token: p.telegram_token, chat_id: p.chat_id }); setModal(true) }

  async function save() {
    if (!f.name.trim()) return alert('Nome obrigatório')
    const payload = { name: f.name, sector: f.sector, active: f.active, telegram_token: f.telegram_token, chat_id: f.chat_id }
    if (editing) await supabase.from('providers').update(payload).eq('id', editing.id)
    else await supabase.from('providers').insert(payload)
    showToast(editing ? 'Prestador atualizado ✓' : 'Prestador criado ✓')
    setModal(false); load()
  }

  async function del(id) {
    if (!confirm('Desativar este prestador? As tarefas vinculadas serão preservadas.')) return
    // Soft delete: marca como inativo (não deleta para preservar histórico de tarefas)
    const { error } = await supabase.from('providers').update({ active: 0 }).eq('id', id)
    if (error) { showToast('Erro ao remover prestador: ' + error.message, 'err'); return }
    showToast('Prestador desativado ✓')
    load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '.75rem' }}>
        <button className="btn-primary" onClick={openNew}>+ Novo Prestador</button>
      </div>
      <div className="cfg-card">
        {providers.length === 0 ? <div className="empty">Nenhum prestador</div> : providers.map(p => (
          <div key={p.id} className="provider-row">
            <div className="provider-avatar">👷</div>
            <div className="provider-info">
              <div className="provider-name">{p.name} {!p.active && <span style={{ color: 'var(--muted)', fontSize: '.75rem' }}>(inativo)</span>}</div>
              <div className={`provider-meta${p.chat_id ? ' chat-linked' : ''}`}>
                {p.sector || 'Sem setor'} {p.chat_id ? ' · 🔗 Telegram vinculado' : ''}
              </div>
            </div>
            <div className="actions">
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
                <div className="fg full"><label className="flabel">NOME *</label><input className="finput" value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} /></div>
                <div className="fg">
                  <label className="flabel">SETOR</label>
                  <select className="finput" value={f.sector} onChange={e => setF(p => ({ ...p, sector: e.target.value }))}>
                    <option value="">Selecione...</option>
                    {sectors.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label className="flabel">ATIVO</label>
                  <select className="finput" value={f.active} onChange={e => setF(p => ({ ...p, active: Number(e.target.value) }))}>
                    <option value={1}>✅ Ativo</option>
                    <option value={0}>❌ Inativo</option>
                  </select>
                </div>
                <div className="fg full"><label className="flabel">CHAT ID TELEGRAM</label><input className="finput" value={f.chat_id} onChange={e => setF(p => ({ ...p, chat_id: e.target.value }))} placeholder="Preenchido automaticamente pelo bot" /></div>
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

// ── SLA ───────────────────────────────────────────────────────────────────
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
      <div className="cfg-title">⏱ Configuração de SLA</div>
      {rows.map(row => (
        <div key={row.urgency} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.6rem 0', borderBottom: '1px solid var(--border)' }}>
          <span className={`ubadge ${row.urgency}`} style={{ width: '90px' }}>{row.urgency}</span>
          <input className="finput" style={{ width: '80px' }} type="number" min="1" value={row.hours} onChange={e => update(row.urgency, 'hours', e.target.value)} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--muted)' }}>horas</span>
          <input className="finput" style={{ flex: 1 }} value={row.label || ''} onChange={e => update(row.urgency, 'label', e.target.value)} placeholder="Rótulo" />
          <button className="btn-sec" onClick={() => save(row)}>Salvar</button>
        </div>
      ))}
    </div>
  )
}

// ── Sectors ──────────────────────────────────────────────────────────────
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
        <input className="finput" placeholder="Novo setor…" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} style={{ flex: 1 }} />
        <button className="btn-primary" onClick={add}>+ Adicionar</button>
      </div>
      <div>
        {sectors.map(s => (
          <span key={s.id} className="sector-tag">
            {s.name}
            <button onClick={() => del(s.id)}>✕</button>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Users ─────────────────────────────────────────────────────────────────
function UsersPanel({ showToast, user: currentUser }) {
  const [users, setUsers] = useState([])
  const [modal, setModal] = useState(false)
  const [f, setF] = useState({ name: '', username: '', password: '', password2: '', role: 'operator' })
  const [saving, setSaving] = useState(false)

  async function load() {
    const { data } = await supabase.auth.admin?.listUsers?.() || {}
    // Admin API não disponível no client side — listar via tabela de perfis se existir
    // Por ora, usamos o método de listar via função ou mostramos nota
    setUsers([])
  }

  // Cria usuário via signUp (requer email confirmation desabilitado no Supabase)
  async function createUser() {
    if (!f.name || !f.username || !f.password) return alert('Preencha todos os campos')
    if (f.password !== f.password2) return alert('As senhas não coincidem')
    if (f.password.length < 6) return alert('Senha mínimo 6 caracteres')
    if (currentUser?.role !== 'admin') { showToast('Apenas admin pode criar usuários', 'err'); return }
    setSaving(true)
    const { error } = await supabase.auth.signUp({
      email: toEmail(f.username),
      password: f.password,
      options: { data: { name: f.name, username: f.username, role: f.role } }
    })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'err'); return }
    showToast('Usuário criado ✓ (verifique o e-mail de confirmação no Supabase)')
    setModal(false)
  }

  return (
    <div>
      <div style={{ marginBottom: '.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {currentUser?.role === 'admin' && (
          <button className="btn-primary" onClick={() => { setF({ name: '', username: '', password: '', password2: '', role: 'operator' }); setModal(true) }}>+ Novo Usuário</button>
        )}
      </div>
      <div className="cfg-card">
        <div className="cfg-title">👥 Usuários do Sistema</div>
        <div className="help-text" style={{ fontSize: '.8rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: '.85rem' }}>
          Usuários são gerenciados pelo <strong>Supabase Auth</strong>.<br />
          Para ver todos os usuários, acesse o painel do Supabase → Authentication → Users.<br />
          O login é feito com o <strong>nome de usuário</strong> (ex: <code style={{ fontFamily: 'var(--mono)', background: 'var(--s3)', padding: '.1rem .3rem', borderRadius: '3px' }}>admin</code>) e a senha cadastrada.
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--muted)' }}>
          Usuário atual: <strong style={{ color: 'var(--accent)' }}>{currentUser?.username || currentUser?.name}</strong>
          <span className={`role-badge ${currentUser?.role}`} style={{ marginLeft: '.5rem' }}>{currentUser?.role}</span>
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
                <div className="fg full"><label className="flabel">NOME COMPLETO *</label><input className="finput" value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} placeholder="Ex: João Silva" /></div>
                <div className="fg"><label className="flabel">USUÁRIO *</label><input className="finput" value={f.username} onChange={e => setF(p => ({ ...p, username: e.target.value }))} placeholder="joao.silva" autoComplete="off" /></div>
                <div className="fg">
                  <label className="flabel">PERMISSÃO *</label>
                  <select className="finput" value={f.role} onChange={e => setF(p => ({ ...p, role: e.target.value }))}>
                    <option value="admin">🔴 Admin</option>
                    <option value="manager">🟠 Gerente</option>
                    <option value="operator">🔵 Operador</option>
                    <option value="viewer">⚪ Visualizador</option>
                  </select>
                </div>
                <div className="fg"><label className="flabel">SENHA *</label><input className="finput" type="password" value={f.password} onChange={e => setF(p => ({ ...p, password: e.target.value }))} placeholder="Mínimo 6 caracteres" /></div>
                <div className="fg"><label className="flabel">CONFIRMAR SENHA</label><input className="finput" type="password" value={f.password2} onChange={e => setF(p => ({ ...p, password2: e.target.value }))} /></div>
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

// ── Telegram ──────────────────────────────────────────────────────────────
function TelegramPanel({ showToast }) {
  const [token, setToken] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    supabase.from('config').select('value').eq('key', 'telegram_token').single()
      .then(r => { if (r.data) setToken(r.data.value || '') })
  }, [])

  async function saveToken() {
    await supabase.from('config').upsert({ key: 'telegram_token', value: token })
    showToast('Token salvo ✓'); setSaved(true)
  }

  return (
    <div>
      <div className="cfg-card">
        <div className="cfg-title">🤖 Bot Telegram</div>
        <div className="fg" style={{ marginBottom: '1rem' }}>
          <label className="flabel">TOKEN DO BOT</label>
          <input className="finput" type="password" value={token} onChange={e => { setToken(e.target.value); setSaved(false) }} placeholder="123456789:AABBccDDee..." />
        </div>
        <button className="btn-primary" onClick={saveToken}>Salvar Token</button>
      </div>

      <div className="cfg-card">
        <div className="cfg-title">📋 Como executar o bot</div>
        <div style={{ fontSize: '.82rem', color: 'var(--muted)', lineHeight: 1.8 }}>
          <p>O bot Telegram precisa rodar em um servidor separado. Opções:</p>
          <br />
          <strong>1. Railway (recomendado — gratuito)</strong>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', background: 'var(--bg)', border: '1px solid var(--border)', padding: '.6rem .85rem', borderRadius: '3px', margin: '.5rem 0', color: 'var(--accent)' }}>
            railway up --service bot
          </div>
          <strong>2. Local (para testes)</strong>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', background: 'var(--bg)', border: '1px solid var(--border)', padding: '.6rem .85rem', borderRadius: '3px', margin: '.5rem 0', color: 'var(--accent)' }}>
            TELEGRAM_TOKEN=seu_token python bot.py
          </div>
          <br />
          <p>Configure a variável <code style={{ fontFamily: 'var(--mono)', background: 'var(--s3)', padding: '.1rem .3rem', borderRadius: '3px' }}>SUPABASE_URL</code> e <code style={{ fontFamily: 'var(--mono)', background: 'var(--s3)', padding: '.1rem .3rem', borderRadius: '3px' }}>SUPABASE_KEY</code> no servidor do bot.</p>
        </div>
      </div>
    </div>
  )
}

// ── Settings (main) ───────────────────────────────────────────────────────
export default function Settings({ showToast, user, session }) {
  const [tab, setTab] = useState('geral')

  return (
    <div>
      <div className="stab-bar">
        {TABS.map(t => (
          <button key={t.id} className={`stab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'geral'     && <GeralPanel     showToast={showToast} />}
      {tab === 'providers' && <ProvidersPanel  showToast={showToast} />}
      {tab === 'sla'       && <SLAPanel        showToast={showToast} />}
      {tab === 'sectors'   && <SectorsPanel    showToast={showToast} />}
      {tab === 'users'     && <UsersPanel      showToast={showToast} user={user} />}
      {tab === 'telegram'  && <TelegramPanel   showToast={showToast} />}
    </div>
  )
}
