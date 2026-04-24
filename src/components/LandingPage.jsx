import { useState } from 'react'
import Login from './Login.jsx'

export default function LandingPage({ onLogin, showToast }) {
  const [showLogin, setShowLogin] = useState(false)

  // Se showLogin, renderiza o Login por cima
  if (showLogin) {
    return <Login onLogin={onLogin} showToast={showToast} onBack={() => setShowLogin(false)} />
  }

  return (
    <div className="landing">
      {/* NAVBAR */}
      <nav className="lnav">
        <div className="lnav-brand">
          <img src="/icon.png" alt="" style={{ width: 32, borderRadius: 8 }} />
          <span>DespachaApp</span>
        </div>
        <div className="lnav-links">
          <a href="#features">Funcionalidades</a>
          <a href="#pricing">Planos</a>
          <button className="btn-sec" onClick={() => setShowLogin(true)}>Entrar</button>
          <button className="btn-primary" onClick={() => setShowLogin(true)}>Começar grátis →</button>
        </div>
      </nav>

      {/* HERO */}
      <section className="lhero">
        <div className="lhero-badge">🚀 Gestão de serviços para equipes modernas</div>
        <h1 className="lhero-title">
          Gerencie tarefas,<br />
          <span style={{ color: 'var(--blue)' }}>colaboradores</span> e clientes<br />
          em um só lugar
        </h1>
        <p className="lhero-sub">
          Do simples controle de tarefas internas ao gerenciamento completo de OS, orçamentos e clientes.
          Notificações pelo Telegram, relatórios em PDF e muito mais.
        </p>
        <div className="lhero-btns">
          <button className="btn-primary lhero-cta" onClick={() => setShowLogin(true)}>
            Começar 14 dias grátis →
          </button>
          <span className="lhero-hint">Sem cartão de crédito • Cancele quando quiser</span>
        </div>

        {/* App preview mockup */}
        <div className="lhero-preview">
          <div className="lpreview-bar">
            <span /><span /><span />
            <div className="lpreview-url">app.despachaapp.com.br</div>
          </div>
          <div className="lpreview-body">
            {[
              { title: 'Instalar tomada — Sala 3', status: 'andamento', urgency: 'alta', assignee: 'João Silva' },
              { title: 'Revisão elétrica — Andar 2', status: 'concluida', urgency: 'critica', assignee: 'Maria Costa' },
              { title: 'Pintura fachada — Cliente ABC', status: 'pendente', urgency: 'media', assignee: 'Pedro Lima', external: true },
              { title: 'Manutenção AC — Sala 1', status: 'andamento', urgency: 'baixa', assignee: 'Ana Souza' },
            ].map((t, i) => (
              <div key={i} className="lpreview-task">
                <span className={`stbadge ${t.status}`} style={{ fontSize: '.65rem' }}>{t.status}</span>
                <span className="lpreview-title">{t.title}{t.external && <span style={{ marginLeft: '.35rem', fontSize: '.65rem', color: 'var(--blue)' }}>🌐</span>}</span>
                <span className={`ubadge ${t.urgency}`} style={{ fontSize: '.6rem' }}>{t.urgency}</span>
                <span className="lpreview-name">{t.assignee}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="lfeatures" id="features">
        <div className="lsection-label">FUNCIONALIDADES</div>
        <h2 className="lsection-title">Tudo que sua equipe precisa</h2>
        <div className="lfeat-grid">
          {[
            { icon: '📋', title: 'Gestão de Tarefas', desc: 'Crie, atribua e acompanhe tarefas com urgência, prazo e SLA. Status em tempo real.' },
            { icon: '🤖', title: 'Bot Telegram', desc: 'Colaboradores recebem e atualizam tarefas direto no Telegram. Sem app extra.' },
            { icon: '📊', title: 'Relatórios PDF/XML', desc: 'Exporte relatórios completos com logo da empresa para clientes e gestores.' },
            { icon: '👥', title: 'Controle de Clientes', desc: 'Cadastre clientes, vincule OS e acompanhe todo o histórico de serviços.' },
            { icon: '💰', title: 'Orçamentos', desc: 'Crie orçamentos e converta em tarefa com um clique. Acompanhe aprovação.' },
            { icon: '💳', title: 'Controle de Caixa', desc: 'Receitas, despesas e pagamento de terceirizados. Tudo integrado às OS.' },
            { icon: '⚡', title: 'Alertas de SLA', desc: 'Alertas automáticos quando o prazo está próximo. Nunca mais perca um SLA.' },
            { icon: '🎨', title: 'White-label', desc: 'Use sua logo e cor principal. Relatórios e painel com a identidade da sua empresa.' },
          ].map(f => (
            <div key={f.title} className="lfeat-card">
              <div className="lfeat-icon">{f.icon}</div>
              <div className="lfeat-title">{f.title}</div>
              <div className="lfeat-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section className="lpricing" id="pricing">
        <div className="lsection-label">PLANOS</div>
        <h2 className="lsection-title">Simples e transparente</h2>
        <div className="lpricing-grid">
          {[
            {
              name: 'Starter', price: 'R$ 97', period: '/mês', color: 'var(--blue)',
              desc: 'Para pequenas equipes',
              features: ['Até 3 usuários', 'Até 5 colaboradores', 'Tarefas ilimitadas', 'Bot Telegram', 'Dashboard e Calendário', 'Relatórios básicos'],
            },
            {
              name: 'Pro', price: 'R$ 197', period: '/mês', color: 'var(--orange)', badge: '⭐ Mais popular',
              desc: 'Para equipes em crescimento',
              features: ['Usuários ilimitados', 'Colaboradores ilimitados', 'Tarefas internas e externas', 'Dados do cliente nas OS', 'Relatórios PDF/XML', 'Suporte via WhatsApp'],
            },
            {
              name: 'Enterprise', price: 'R$ 497', period: '/mês', color: 'var(--purple)', badge: '🏢 Completo',
              desc: 'Gestão completa de serviços',
              features: ['Tudo do Pro', 'Controle de Clientes', 'Orçamentos → Tarefa', 'Controle de Caixa', 'Pagamento de terceiros', 'Relatório automático semanal', 'White-label', 'Suporte prioritário'],
            },
          ].map(p => (
            <div key={p.name} className={`lplan-card${p.badge ? ' lplan-featured' : ''}`} style={{ '--plan-color': p.color }}>
              {p.badge && <div className="lplan-badge">{p.badge}</div>}
              <div className="lplan-name" style={{ color: p.color }}>{p.name}</div>
              <div className="lplan-desc">{p.desc}</div>
              <div className="lplan-price">{p.price}<span className="lplan-period">{p.period}</span></div>
              <ul className="lplan-features">
                {p.features.map(f => <li key={f}>✅ {f}</li>)}
              </ul>
              <button className="lplan-btn" style={{ background: p.color }} onClick={() => setShowLogin(true)}>
                Começar grátis →
              </button>
            </div>
          ))}
        </div>
        <div className="lpricing-note">
          🔒 Pagamento seguro via Stripe · 14 dias grátis · Cancele quando quiser · Sem taxa de cancelamento
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="lsocial">
        <div className="lsection-label">POR QUE ESCOLHER</div>
        <div className="lstats-grid">
          {[
            { val: '14 dias', label: 'Trial gratuito' },
            { val: '100%', label: 'Web — sem instalar nada' },
            { val: 'Telegram', label: 'Notificações em tempo real' },
            { val: 'PDF + XML', label: 'Relatórios profissionais' },
          ].map(s => (
            <div key={s.label} className="lstat">
              <div className="lstat-val">{s.val}</div>
              <div className="lstat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="lcta">
        <h2 className="lcta-title">Pronto para organizar sua equipe?</h2>
        <p className="lcta-sub">Comece hoje. 14 dias grátis, sem cartão de crédito.</p>
        <button className="btn-primary lhero-cta" onClick={() => setShowLogin(true)}>
          Criar conta gratuita →
        </button>
      </section>

      {/* FOOTER */}
      <footer className="lfooter">
        <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem' }}>
          <img src="/icon.png" alt="" style={{ width: 24, borderRadius: 6 }} />
          <span style={{ fontWeight: 700 }}>DespachaApp</span>
        </div>
        <div style={{ color: 'var(--muted)', fontSize: '.8rem' }}>
          © 2026 DespachaApp · Todos os direitos reservados
        </div>
        <div style={{ display: 'flex', gap: '1.5rem', fontSize: '.82rem' }}>
          <a href="mailto:contato@despachaapp.com.br" style={{ color: 'var(--muted)', textDecoration: 'none' }}>Contato</a>
          <a href="#pricing" style={{ color: 'var(--muted)', textDecoration: 'none' }}>Planos</a>
        </div>
      </footer>
    </div>
  )
}
