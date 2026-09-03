export const config = { runtime: 'edge' }

import { makeDb } from '../v1/_auth.js'

const SLA_DEFAULTS = { critica: 4, alta: 8, media: 24, baixa: 72 }

async function sendTelegram(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token || !chatId) return
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    })
  } catch (e) {
    console.error('Telegram send error:', e)
  }
}

export default async function handler(req) {
  const cronHeader = req.headers.get('x-vercel-cron')
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  const isVercelCron = cronHeader === '1'
  const isSecretAuth = cronSecret && authHeader === `Bearer ${cronSecret}`

  if (!isVercelCron && !isSecretAuth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const supabase = makeDb()
  const now = new Date()

  const { data: companies, error: compErr } = await supabase
    .from('companies')
    .select('id, name, telegram_chat_id')
    .in('subscription_status', ['active', 'trialing'])

  if (compErr) {
    return new Response(JSON.stringify({ error: compErr.message }), { status: 500 })
  }

  const { data: slaRows } = await supabase.from('sla_config').select('urgency, hours')
  const slaMap = {}
  if (slaRows) slaRows.forEach(r => { slaMap[r.urgency] = Number(r.hours) })

  function getSlaHours(urgency) {
    return slaMap[urgency] ?? SLA_DEFAULTS[urgency] ?? 24
  }

  let totalChecked  = 0
  let totalNotified = 0

  for (const company of companies || []) {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title, urgency, created_at, assignee_id, status')
      .eq('company_id', company.id)
      .not('status', 'in', '("concluida","cancelada")')

    if (!tasks || tasks.length === 0) continue
    totalChecked += tasks.length

    for (const task of tasks) {
      const slaHours  = getSlaHours(task.urgency)
      const createdAt = new Date(task.created_at)
      const deadline  = new Date(createdAt.getTime() + slaHours * 60 * 60 * 1000)
      const twoHours  = 2 * 60 * 60 * 1000

      const approaching = now >= new Date(deadline.getTime() - twoHours) && now < deadline
      const overdue     = now >= deadline && now < new Date(deadline.getTime() + twoHours)

      if (!approaching && !overdue) continue

      let providerName   = 'Prestador'
      let providerChatId = null
      if (task.assignee_id) {
        const { data: provider } = await supabase
          .from('providers')
          .select('name, chat_id')
          .eq('id', task.assignee_id)
          .single()
        if (provider) {
          providerName   = provider.name
          providerChatId = provider.chat_id
        }
      }

      const deadlineStr = deadline.toLocaleString('pt-BR')
      let message
      if (approaching) {
        message = `⚠️ *SLA: ${task.title}*\nPrazo em breve! Conclua antes de ${deadlineStr}\n🔴 Urgência: ${task.urgency}`
      } else {
        message = `🚨 *SLA VENCIDO: ${task.title}*\nPrazo expirado em ${deadlineStr}\n📌 Prestador: ${providerName}`
      }

      await sendTelegram(providerChatId, message)
      await sendTelegram(company.telegram_chat_id, message)

      try {
        await supabase.from('tasks').update({ sla_notified: true }).eq('id', task.id)
      } catch (_) {}

      totalNotified++
    }
  }

  return new Response(
    JSON.stringify({ ok: true, companies: (companies || []).length, checked: totalChecked, notified: totalNotified }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
