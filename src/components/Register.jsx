import { useState } from 'react'
import { supabase, toEmail } from '../lib/supabase.js'

const DEFAULT_SLA = [
  { urgency: 'critica', hours: 2,  label: 'Crítica — 2h' },
  { urgency: 'alta',    hours: 8,  label: 'Alta — 8h' },
  { urgency: 'media',   hours: 24, label: 'Média — 24h' },
  { urgency: 'baixa',   hours: 72, label: 'Baixa — 72h' },
]

export default function Register({ onBack, onRegistered, showToast }) {
  const [step,    setStep]    = useState(1)
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState('')
  const [company, setCompany] = useState({ name: '' })
  const [admin,   setAdmin]   = useState({ name: '', username: '', password: '', password2: '' })

  async function handleRegister() {
    if (!admin.name.trim())     { setErr('Nome obrigatório'); return }
    if (!admin.username.trim()) { setErr('Usuário obrigatório'); return }
    if (admin.password.length < 6) { setErr('Senha mínimo 6 caracteres'); return }
    if (admin.password !== admin.password2) { setErr('As senhas não coincidem'); return }

    setLoading(true); setErr('')
    try {
      // 1. Criar empresa via RPC segura (bypassa RLS para retornar o id)
      // trial_ends_at é definido automaticamente pela migration_stripe.sql (NOW() + 14 days)
      const { data: company_id, error: compErr } = await supabase
        .rpc('create_company', { company_name: company.name.trim() })
      if (compErr) throw new Error('Erro ao criar empresa: ' + compErr.message)

      // 2. Criar usuário admin com company_id no metadata
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: toEmail(admin.username),
        password: admin.password,
        options: {
          data: { name: admin.name, username: admin.username, role: 'admin', company_id }
        }
      })
      if (authErr) throw new Error('Erro ao criar usuário: ' + authErr.message)

      // 3. Fazer login para ter sessão com company_id
      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email: toEmail(admin.username),
        password: admin.password,
      })
      if (loginErr) throw new Error('Erro ao entrar: ' + loginErr.message)

      // 4. Seed: SLA padrão e setor padrão
      await Promise.all([
        supabase.from('sla_config').insert(DEFAULT_SLA.map(s => ({ ...s, company_id }))),
        supabase.from('sectors').insert([
          { name: 'Geral', active: 1, company_id },
          { name: 'Manutenção', active: 1, company_id },
        ]),
        supabase.from('config').insert({ key: 'company_name', value: company.name.trim(), company_id }),
      ])

      showToast(`Bem-vindo, ${admin.name}! Empresa criada com sucesso.`)
      const { data: { session } } = await supabase.auth.getSession()
      onRegistered(session)

    } catch (e) {
      setErr(e.message)
    }
    setLoading(false)
  }

  return (
    <div className="login-overlay">
      <div className="login-box" style={{ width: 460 }}>
        <div className="login-logo">
          <div className="login-logo-wrap">
            <img src="/logo.png" alt="DespachaApp" className="login-logo-img" />
          </div>
          <div className="login-sub">Criar nova conta</div>
        </div>

        {/* Progress */}
        <div className="reg-steps">
          <div className={`reg-step-dot${step >= 1 ? ' done' : ''}`}>1</div>
          <div className="reg-step-line" />
          <div className={`reg-step-dot${step >= 2 ? ' done' : ''}`}>2</div>
        </div>

        {step === 1 && (
          <div>
            <div className="login-field">
              <label>NOME DA EMPRESA *</label>
              <input
                type="text" placeholder="Ex: Construtora ABC Ltda"
                value={company.name} onChange={e => setCompany({ name: e.target.value })}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && company.name.trim() && setStep(2)}
              />
            </div>
            <button className="login-btn" onClick={() => { if (!company.name.trim()) { setErr('Informe o nome da empresa'); return } setErr(''); setStep(2) }}>
              PRÓXIMO →
            </button>
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginBottom: '.75rem', textAlign: 'center' }}>
              🏢 <strong style={{ color: 'var(--text)' }}>{company.name}</strong>
            </div>
            <div className="login-field">
              <label>SEU NOME *</label>
              <input type="text" placeholder="Ex: João Silva" value={admin.name}
                onChange={e => setAdmin(p => ({ ...p, name: e.target.value }))} autoFocus />
            </div>
            <div className="login-field">
              <label>USUÁRIO DE LOGIN *</label>
              <input type="text" placeholder="joao.silva" value={admin.username}
                onChange={e => setAdmin(p => ({ ...p, username: e.target.value }))} autoComplete="off" />
            </div>
            <div className="login-field">
              <label>SENHA *</label>
              <input type="password" placeholder="Mínimo 6 caracteres" value={admin.password}
                onChange={e => setAdmin(p => ({ ...p, password: e.target.value }))} />
            </div>
            <div className="login-field">
              <label>CONFIRMAR SENHA</label>
              <input type="password" placeholder="Repita a senha" value={admin.password2}
                onChange={e => setAdmin(p => ({ ...p, password2: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleRegister()} />
            </div>
            <div style={{ display: 'flex', gap: '.65rem' }}>
              <button className="btn-sec" style={{ flex: 1 }} onClick={() => { setStep(1); setErr('') }}>← Voltar</button>
              <button className="login-btn" style={{ flex: 2, margin: 0 }} onClick={handleRegister} disabled={loading}>
                {loading ? 'CRIANDO CONTA…' : 'CRIAR CONTA'}
              </button>
            </div>
          </div>
        )}

        <div className="login-err">{err}</div>
        <div style={{ textAlign: 'center', marginTop: '.85rem' }}>
          <button className="btn-sec" style={{ fontSize: '.8rem' }} onClick={onBack}>
            Já tenho conta — Entrar
          </button>
        </div>
      </div>
    </div>
  )
}
