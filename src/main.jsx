import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

// ── Roteamento simples (sem dependência de router) ───────────────────────────
const path = window.location.pathname

async function mount() {
  const root = ReactDOM.createRoot(document.getElementById('root'))
  if (path.startsWith('/solicitar')) {
    const { default: PublicRequestForm } = await import('./components/PublicRequestForm.jsx')
    root.render(<React.StrictMode><PublicRequestForm /></React.StrictMode>)
  } else if (path.startsWith('/acompanhar')) {
    const { default: PublicTrackForm } = await import('./components/PublicTrackForm.jsx')
    root.render(<React.StrictMode><PublicTrackForm /></React.StrictMode>)
  } else {
    const { default: App } = await import('./App.jsx')
    root.render(<React.StrictMode><App /></React.StrictMode>)
  }
}

mount()
