/**
 * DespachaApp — Gerador de tarefas recorrentes
 * GET  /api/cron/gen-recurring          → chamado pelo cron diário (Vercel)
 * POST /api/cron/gen-recurring          → { recurrence_id } para gerar imediatamente ao criar
 *
 * Lógica: para cada regra ativa, gera tarefas nos próximos 60 dias
 * que ainda não existam. Atualiza last_generated ao final.
 */
import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

/** Adiciona N dias a uma string 'YYYY-MM-DD' */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}

/** Retorna lista de datas 'YYYY-MM-DD' que pertencem à regra no intervalo [from, to] */
function getOccurrences(rec, from, to, skipWeekendsDefault = true) {
  const dates = []

  // Respeita start_date da regra
  const effectiveFrom = rec.start_date > from ? rec.start_date : from
  // Respeita end_date da regra
  const effectiveTo   = rec.end_date && rec.end_date < to ? rec.end_date : to

  if (effectiveFrom > effectiveTo) return dates

  // skip_weekends: campo da recorrência tem prioridade; se null usa padrão global
  const skipWeekends = rec.skip_weekends !== null && rec.skip_weekends !== undefined
    ? rec.skip_weekends
    : skipWeekendsDefault

  let d = new Date(effectiveFrom + 'T00:00:00Z')
  const end = new Date(effectiveTo + 'T00:00:00Z')

  if (rec.frequency === 'daily') {
    while (d <= end) {
      const dow = d.getUTCDay() // 0=Dom, 6=Sáb
      if (!skipWeekends || (dow !== 0 && dow !== 6)) {
        dates.push(d.toISOString().split('T')[0])
      }
      d.setUTCDate(d.getUTCDate() + 1)
    }

  } else if (rec.frequency === 'weekly') {
    const dow = rec.day_of_week ?? 5  // padrão: Sexta
    // Avança até o primeiro dia da semana correto
    while (d.getUTCDay() !== dow && d <= end) d.setUTCDate(d.getUTCDate() + 1)
    while (d <= end) {
      dates.push(d.toISOString().split('T')[0])
      d.setUTCDate(d.getUTCDate() + 7)
    }

  } else if (rec.frequency === 'weekly_custom') {
    const allowedDays = new Set(rec.days_of_week || [])
    while (d <= end) {
      if (allowedDays.has(d.getUTCDay())) {
        dates.push(d.toISOString().split('T')[0])
      }
      d.setUTCDate(d.getUTCDate() + 1)
    }

  } else if (rec.frequency === 'monthly') {
    const dom = Math.min(rec.day_of_month ?? 1, 28)
    // Primeiro mês que contenha uma data >= effectiveFrom
    d = new Date(Date.UTC(
      new Date(effectiveFrom + 'T00:00:00Z').getUTCFullYear(),
      new Date(effectiveFrom + 'T00:00:00Z').getUTCMonth(),
      dom
    ))
    // Se o dia já passou neste mês, pula para o próximo
    if (d < new Date(effectiveFrom + 'T00:00:00Z')) d.setUTCMonth(d.getUTCMonth() + 1)
    while (d <= end) {
      dates.push(d.toISOString().split('T')[0])
      d.setUTCMonth(d.getUTCMonth() + 1)
    }
  }

  return dates
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const sb = createClient(
    process.env.SUPABASE_URL        || '',
    process.env.SUPABASE_SERVICE_KEY || ''
  )

  // Para geração imediata após criação: { recurrence_id: N }
  let targetId = null
  if (req.method === 'POST') {
    try { const b = await req.json(); targetId = b?.recurrence_id ?? null } catch {}
  }

  const today   = new Date().toISOString().split('T')[0]
  const horizon = addDays(today, 60)  // gera tarefas até 60 dias à frente

  let query = sb.from('task_recurrences').select('*').eq('active', true)
  if (targetId) query = query.eq('id', Number(targetId))

  const { data: recurrences, error: rErr } = await query
  if (rErr) return json({ error: rErr.message }, 500)

  // Carrega config de "pular fins de semana" por company_id
  const companyIds = [...new Set((recurrences || []).map(r => r.company_id).filter(Boolean))]
  const configMap = {}
  if (companyIds.length > 0) {
    const { data: cfgRows } = await sb.from('config')
      .select('value, company_id')
      .eq('key', 'recurrence_skip_weekends')
      .in('company_id', companyIds)
    for (const row of cfgRows || []) {
      configMap[row.company_id] = row.value === 'true' || row.value === true
    }
  }

  // Flip: tarefas "cadastrada" com due_date <= hoje viram "pendente"
  await sb.from('tasks')
    .update({ status: 'pendente' })
    .eq('status', 'cadastrada')
    .lte('due_date', today)

  let totalGenerated = 0
  const results = []

  for (const rec of recurrences || []) {
    // Começa a gerar a partir do dia após o último gerado (ou hoje)
    const from = rec.last_generated ? addDays(rec.last_generated, 1) : today
    const to   = horizon

    // Padrão global da empresa (true = pular fds); se não configurado, padrão é true
    const globalSkip = rec.company_id !== null && rec.company_id in configMap
      ? configMap[rec.company_id]
      : true

    const dates = getOccurrences(rec, from, to, globalSkip)
    if (dates.length === 0) { results.push({ id: rec.id, generated: 0 }); continue }

    // Verifica quais já existem para evitar duplicatas
    const { data: existing } = await sb.from('tasks')
      .select('recurrence_date')
      .eq('recurrence_id', rec.id)
      .in('recurrence_date', dates)

    const existingSet = new Set((existing || []).map(r => r.recurrence_date))
    const newDates    = dates.filter(d => !existingSet.has(d))

    if (newDates.length === 0) {
      // Atualiza last_generated mesmo sem inserir (horizon pode ter avançado)
      await sb.from('task_recurrences')
        .update({ last_generated: dates[dates.length - 1] })
        .eq('id', rec.id)
      results.push({ id: rec.id, generated: 0 })
      continue
    }

    const rows = newDates.map(date => ({
      title:            rec.title,
      description:      rec.description || null,
      requester:        rec.requester   || 'Sistema',
      requester_sector: rec.requester_sector || null,
      assignee_id:      rec.assignee_id || null,
      assignee:         rec.assignee    || '',
      urgency:          rec.urgency     || 'media',
      category:         rec.category    || null,
      sector:           rec.sector      || null,
      status:           date > today ? 'cadastrada' : 'pendente',
      due_date:         date,
      recurrence_id:    rec.id,
      recurrence_date:  date,
      source:           'recorrencia',
      company_id:       rec.company_id  || null,
    }))

    const { error: iErr } = await sb.from('tasks').insert(rows)

    if (!iErr) {
      totalGenerated += newDates.length
      await sb.from('task_recurrences')
        .update({ last_generated: dates[dates.length - 1] })
        .eq('id', rec.id)
      results.push({ id: rec.id, title: rec.title, generated: newDates.length })
    } else {
      console.error('[gen-recurring] insert error:', iErr.message)
      results.push({ id: rec.id, error: iErr.message })
    }
  }

  return json({ ok: true, total: totalGenerated, results })
}
