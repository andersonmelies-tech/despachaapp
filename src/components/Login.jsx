import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import Register from './Register.jsx'

export default function Login({ onLogin, showToast }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [err,      setErr]      = useState('')
  const [showReg,  setShowReg]  = useState(false)

  if (showReg) {
    return (
      <Register
        onBack={() => setShowReg(false)}
        onRegistered={s => onLogin(s)}
        showToast={showToast}
      />
    )
  }

  async function handleLogin(e) {
    e.preventDefault()
    if (!username.trim() || !password) { setErr('Preencha usuário e senha'); return }
    setLoading(true); setErr('')

    // Extrai a parte local (antes do @, se houver) e monta o email interno
    const localPart = username.toLowerCase().trim().split('@')[0]
    const internalEmail = `${localPart}@despachaapp.internal`

    // Tenta primeiro com email interno (usuários criados pelo admin)
    let { data, error } = await supabase.auth.signInWithPassword({ email: internalEmail, password })

    // Se falhou e o input parece um email real (tem @), tenta como email direto (donos de conta)
    if (error && username.includes('@') && !username.endsWith('@despachaapp.internal')) {
      const result = await supabase.auth.signInWithPassword({ email: username.trim(), password })
      data  = result.data
      error = result.error
    }

    setLoading(false)
    if (error) { setErr('Usuário ou senha incorretos'); return }
    onLogin(data.session)
  }

  return (
    <div className="login-overlay">
      <div className="login-center">

        {/* Logo acima do card, sobre o fundo azul */}
        <div className="login-logo">
          <img src="/logo.png" alt="DespachaApp" className="login-logo-img" />
        </div>

        {/* Card branco com o formulário */}
        <div className="login-box">
          <form onSubmit={handleLogin}>
            <div className="login-field">
              <label>USUÁRIO</label>
              <input type="text" placeholder="seu.usuario" autoComplete="username"
                value={username} onChange={e => setUsername(e.target.value)} autoFocus />
              <div className="login-field-hint">
                Digite apenas o usuário — não o e-mail da empresa
              </div>
            </div>
            <div className="login-field">
              <label>SENHA</label>
              <input type="password" placeholder="••••••••" autoComplete="current-password"
                value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            <button className="login-btn" type="submit" disabled={loading}>
              {loading ? 'ENTRANDO...' : 'ENTRAR'}
            </button>
            <div className="login-err">{err}</div>
          </form>
          <div style={{ textAlign: 'center', marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <span style={{ fontSize: '.8rem', color: 'var(--muted)' }}>Não tem conta? </span>
            <button className="btn-sec" style={{ fontSize: '.8rem' }} onClick={() => setShowReg(true)}>
              Criar conta grátis →
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
