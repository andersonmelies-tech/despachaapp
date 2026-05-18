/**
 * DespachaApp — Registra o webhook do Telegram
 *
 * Chame UMA VEZ após o deploy:
 *   GET https://<seu-dominio>/api/telegram/setup?secret=<ADMIN_SECRET>
 *
 * Onde ADMIN_SECRET é a env var ADMIN_SECRET configurada no Vercel.
 * Isso aponta o Telegram para o endpoint /api/telegram/webhook.
 */
export const config = { runtime: 'edge' }

export default async function handler(req) {
  const url    = new URL(req.url)
  const secret = url.searchParams.get('secret')

  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const TOKEN          = process.env.TELEGRAM_TOKEN || ''
  const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ''
  const domain         = url.origin  // ex: https://despachaapp.vercel.app

  if (!TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: 'TELEGRAM_TOKEN não configurado' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  const webhookUrl = `${domain}/api/telegram/webhook`

  // Remove webhook anterior
  await fetch(`https://api.telegram.org/bot${TOKEN}/deleteWebhook`, { method: 'POST' })

  // Registra o novo webhook
  const body = { url: webhookUrl, max_connections: 10, drop_pending_updates: true }
  if (WEBHOOK_SECRET) body.secret_token = WEBHOOK_SECRET

  const res  = await fetch(`https://api.telegram.org/bot${TOKEN}/setWebhook`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  const data = await res.json()

  // Busca info do bot para confirmar
  const infoRes  = await fetch(`https://api.telegram.org/bot${TOKEN}/getMe`)
  const infoData = await infoRes.json()

  return new Response(JSON.stringify({
    ok:          data.ok,
    description: data.description,
    webhook_url: webhookUrl,
    bot:         infoData.result,
  }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
