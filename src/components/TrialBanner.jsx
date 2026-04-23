export default function TrialBanner({ daysLeft, plan, onUpgrade, onManage }) {
  if (plan && plan !== 'trial') return null   // Assinante ativo — não mostra

  const urgent = daysLeft <= 3

  return (
    <div className={`trial-banner${urgent ? ' urgent' : ''}`}>
      <span className="trial-banner-text">
        {daysLeft > 0
          ? <>⏳ Trial termina em <strong>{daysLeft} dia{daysLeft !== 1 ? 's' : ''}</strong></>
          : <>⚠️ <strong>Seu trial expirou</strong> — o acesso será limitado</>}
      </span>
      <button className="trial-banner-btn" onClick={onUpgrade}>
        🚀 Assinar plano
      </button>
    </div>
  )
}
