import { useState } from 'react'
import { supabase, toEmail } from '../lib/supabase.js'
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
    const { data, error } = await supabase.auth.signInWithPassword({
      email: toEmail(username), password
    })
    setLoading(false)
    if (error) { setErr('Usuário ou senha incorretos'); return }
    onLogin(data.session)
  }

  return (
    <div className="login-overlay">
      <div className="login-box">
        <div className="login-logo">
          <div className="login-logo-wrap">
            <img src="/logo.png" alt="DespachaApp" className="login-logo-img" />
          </div>
          <div className="login-sub" style={{ display: 'none' }}>Gerenciamento de Tarefas Ágil</div>
        </div>
        <form onSubmit={handleLogin}>
          <div className="login-field">
            <label>USUÁRIO</label>
            <input type="text" placeholder="seu.usuario" autoComplete="username"
              value={username} onChange={e => setUsername(e.target.value)} autoFocus />
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
  )
}
