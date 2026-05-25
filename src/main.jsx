import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

// ── Roteamento simples: /solicitar → formulário público (sem auth) ────────────
const isPublicForm = window.location.pathname.startsWith('/solicitar')

async function mount() {
  const root = ReactDOM.createRoot(document.getElementById('root'))
  if (isPublicForm) {
    const { default: PublicRequestForm } = await import('./components/PublicRequestForm.jsx')
    root.render(<React.StrictMode><PublicRequestForm /></React.StrictMode>)
  } else {
    const { default: App } = await import('./App.jsx')
    root.render(<React.StrictMode><App /></React.StrictMode>)
  }
}

mount()
