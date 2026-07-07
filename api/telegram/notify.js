/**
 * DespachaApp — Telegram Notification Endpoint
 *
 * Substitui o job `notify_new_tasks` que rodava a cada 30s no Railway.
 * Chamado de duas formas:
 *   1. Pelo frontend (TaskDetail.jsx) logo após criar uma tarefa — fire-and-forget
 *   2. Pelo Supabase Database Webhook — configurar em:
 *      Supabase Dashboard → Database → Webhooks → New webhook
 *      Table: tasks | Event: INSERT | URL: https://<seu-dominio>/api/telegram/notify
 *
 * Payload aceito:
 *   { task_id: 123 }                  — notifica uma tarefa específica
 *   { record: { ...task } }           — payload do Supabase database webhook
 *   {}                                — varre todas as tarefas não notificadas (fallback)
 */
import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const TOKEN = process.env.TELEGRAM_TOKEN || ''
const TG    = `https://api.telegram.org/bot${TOKEN}`
const sb    = createClient(
  process.env.SUPABASE_URL    || '',
  process.env.SUPABASE_SERVICE_KEY || ''
)

const URG = { critica: '🚨 CRÍTICA', alta: '🔴 Alta', media: '🟡 Média', baixa: '🟢 Baixa' }

function fmtDate(d) {
  if (!d) return '–'
  try {
    const dt = new Date(d)
    if (String(d).includes('T')) {
      return dt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    }
    return dt.toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return String(d).slice(0, 10) }
}

async function notifyTask(task) {
  if (!task?.assignee_id)            return
  if (task.provider_notified)        return
  if (task.status === 'cancelada')   return

  // Marca como notificado ANTES de enviar (evita duplicata em caso de retry)
  await sb.from('tasks').update({ provider_notified: true }).eq('id', task.id)

  // Busca prestador da mesma empresa
  let q = sb.from('providers').select('chat_id, name, company_id').eq('id', task.assignee_id)
  if (task.company_id) q = q.eq('company_id', task.company_id)
  const { data: prov } = await q.maybeSingle()

  if (!prov?.chat_id) return  // prestador sem Telegram vinculado

  const urg = URG[task.urgency] || ''
  // sla_deadline só existe após início; due_date está sempre presente (data do dia para recorrentes)
  const deadlineLine = task.sla_deadline
    ? `⏱ *Conclusão prevista (SLA):* ${fmtDate(task.sla_deadline)}`
    : task.due_date
      ? `📅 *Data prevista:* ${fmtDate(task.due_date)}`
      : ''
  const scheduledLine = task.scheduled_start
    ? `🗓 *Previsão de início:* ${fmtDate(task.scheduled_start)}`
    : ''
  const msg = (
    `🔔 *Nova tarefa atribuída a você!*\n\n` +
    `${urg} *#${task.id}* — ${task.title}\n\n` +
    `📝 ${task.description || '–'}\n` +
    `👤 Solicitante: ${task.requester || '–'}\n` +
    `🏢 Setor: ${task.sector || '–'}\n` +
    (scheduledLine ? scheduledLine + '\n' : '') +
    (deadlineLine  ? deadlineLine  + '\n' : '') +
    `\n_Use o menu para ver detalhes e iniciar a tarefa._`
  )
  const keyboard = {
    inline_keyboard: [[
      { text: '👁 Ver Tarefa', callback_data: `view:${task.id}` },
      { text: '🏠 Menu',       callback_data: 'menu' },
    ]],
  }

  await fetch(`${TG}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id:      parseInt(prov.chat_id),
      text:         msg,
      parse_mode:   'Markdown',
      reply_markup: keyboard,
    }),
  })
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let body = {}
  try { body = await req.json() } catch {}

  try {
    // Forma 1: { task_id: 123 }
    if (body.task_id) {
      const { data: task } = await sb.from('tasks').select('*').eq('id', body.task_id).maybeSingle()
      if (task) await notifyTask(task)
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    // Forma 2: payload do Supabase Database Webhook { type, table, record }
    if (body.record) {
      await notifyTask(body.record)
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    // Forma 3: fallback — varre todas as pendentes (útil para reprocessar)
    const { data: tasks } = await sb.from('tasks')
      .select('*')
      .eq('provider_notified', false)
      .neq('status', 'cancelada')
      .limit(50)

    if (tasks?.length) {
      await Promise.all(tasks.map(notifyTask))
    }

    return new Response(JSON.stringify({ ok: true, notified: tasks?.length ?? 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('[notify]', e)
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
