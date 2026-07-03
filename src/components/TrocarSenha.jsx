import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function TrocarSenha({ onConcluido }) {
  const [novaSenha,      setNovaSenha]      = useState('')
  const [confirmar,      setConfirmar]      = useState('')
  const [loading,        setLoading]        = useState(false)
  const [err,            setErr]            = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    if (novaSenha.length < 6) { setErr('A senha deve ter pelo menos 6 caracteres'); return }
    if (novaSenha !== confirmar) { setErr('As senhas não coincidem'); return }

    setLoading(true)
    // Altera a senha
    const { error: errSenha } = await supabase.auth.updateUser({ password: novaSenha })
    if (errSenha) { setErr(errSenha.message); setLoading(false); return }

    // Limpa o flag de troca obrigatória e força refresh da sessão
    await supabase.auth.updateUser({ data: { must_change_password: false } })
    await supabase.auth.refreshSession()
    setLoading(false)
    onConcluido()
  }

  return (
    <div className="login-overlay">
      <div className="login-center">
        <div className="login-logo">
          <img src="/logo.png" alt="DespachaApp" className="login-logo-img" />
        </div>

      <div className="login-box">
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)', marginBottom: '.25rem' }}>
            Troca de senha obrigatória
          </div>
          <div style={{ fontSize: '.82rem', color: 'var(--muted)' }}>
            Defina uma nova senha para continuar
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="login-field">
            <label>NOVA SENHA</label>
            <input
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              value={novaSenha}
              onChange={e => setNovaSenha(e.target.value)}
              autoFocus
            />
          </div>
          <div className="login-field">
            <label>CONFIRMAR SENHA</label>
            <input
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              value={confirmar}
              onChange={e => setConfirmar(e.target.value)}
            />
          </div>
          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? 'SALVANDO...' : 'DEFINIR SENHA'}
          </button>
          <div className="login-err">{err}</div>
        </form>
      </div>
      </div>
    </div>
  )
}
