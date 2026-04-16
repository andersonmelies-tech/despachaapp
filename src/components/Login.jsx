import { useState } from 'react'
import { supabase, toEmail } from '../lib/supabase.js'

export default function Login({ onLogin, showToast }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    if (!username.trim() || !password) { setErr('Preencha usuário e senha'); return }
    setLoading(true); setErr('')
    const { data, error } = await supabase.auth.signInWithPassword({
      email: toEmail(username),
      password
    })
    setLoading(false)
    if (error) { setErr('Usuário ou senha incorretos'); return }
    onLogin(data.session)
  }

  return (
    <div className="login-overlay">
      <div className="login-box">
        <div className="login-logo">
          <div className="login-brand-icon">✈</div>
          <div className="login-app-name">DESPACHA<span>APP</span></div>
          <div className="login-sub">Gerenciamento de Tarefas Ágil</div>
        </div>
        <form onSubmit={handleLogin}>
          <div className="login-field">
            <label>USUÁRIO</label>
            <input
              type="text" placeholder="seu.usuario" autoComplete="username"
              value={username} onChange={e => setUsername(e.target.value)}
              autoFocus
            />
          </div>
          <div className="login-field">
            <label>SENHA</label>
            <input
              type="password" placeholder="••••••••" autoComplete="current-password"
              value={password} onChange={e => setPassword(e.target.value)}
            />
          </div>
          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? 'ENTRANDO...' : 'ENTRAR'}
          </button>
          <div className="login-err">{err}</div>
        </form>
      </div>
    </div>
  )
}
