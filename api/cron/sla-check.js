export const config = { runtime: 'edge' }

import { createClient } from '@supabase/supabase-js'

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
  // Security: accept Vercel cron header OR CRON_SECRET
  const cronHeader  = req.headers.get('x-vercel-cron')
  const authHeader  = req.headers.get('authorization')
  const cronSecret  = process.env.CRON_SECRET

  const isVercelCron = cronHeader === '1'
  const isSecretAuth = cronSecret && authHeader === `Bearer ${cronSecret}`

  if (!isVercelCron && !isSecretAuth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  )

  const now = new Date()

  // 1. Fetch active companies
  const { data: companies, error: compErr } = await supabase
    .from('companies')
    .select('id, name, telegram_chat_id')
    .in('subscription_status', ['active', 'trialing'])

  if (compErr) {
    return new Response(JSON.stringify({ error: compErr.message }), { status: 500 })
  }

  // 2. Fetch SLA config (global or per company if needed)
  const { data: slaRows } = await supabase.from('sla_config').select('urgency, hours')
  const slaMap = {}
  if (slaRows) slaRows.forEach(r => { slaMap[r.urgency] = Number(r.hours) })

  function getSlaHours(urgency) {
    return slaMap[urgency] ?? SLA_DEFAULTS[urgency] ?? 24
  }

  let totalChecked = 0
  let totalNotified = 0

  for (const company of companies) {
    // 3. Fetch non-concluded tasks for this company
    let tasksQuery = supabase
      .from('tasks')
      .select('id, title, urgency, created_at, assignee_id, status')
      .eq('company_id', company.id)
      .not('status', 'in', '("concluida")')

    // Gracefully handle sla_notified column — only filter if it exists
    try {
      tasksQuery = tasksQuery.not('sla_notified', 'is', true)
    } catch (_) {
      // column may not exist yet; proceed without filter
    }

    const { data: tasks } = await tasksQuery

    if (!tasks || tasks.length === 0) continue

    totalChecked += tasks.length

    for (const task of tasks) {
      const slaHours   = getSlaHours(task.urgency)
      const createdAt  = new Date(task.created_at)
      const deadline   = new Date(createdAt.getTime() + slaHours * 60 * 60 * 1000)
      const twoHours   = 2 * 60 * 60 * 1000

      const approaching = now >= new Date(deadline.getTime() - twoHours) && now < deadline
      const overdue     = now >= deadline && now < new Date(deadline.getTime() + twoHours)

      if (!approaching && !overdue) continue

      // Fetch provider info
      let providerName = 'Prestador'
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

      // Send to provider and company
      await sendTelegram(providerChatId, message)
      await sendTelegram(company.telegram_chat_id, message)

      // Mark as sla_notified (graceful — ignore if column missing)
      try {
        await supabase
          .from('tasks')
          .update({ sla_notified: true })
          .eq('id', task.id)
      } catch (_) {
        // column may not exist yet
      }

      totalNotified++
    }
  }

  return new Response(
    JSON.stringify({ ok: true, companies: companies.length, checked: totalChecked, notified: totalNotified }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
