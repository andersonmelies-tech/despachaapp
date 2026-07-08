/**
 * DespachaApp — Telegram Bot Webhook
 * Substitui o polling do Railway por um endpoint serverless no Vercel (grátis).
 *
 * Variáveis de ambiente necessárias (Vercel Dashboard → Settings → Env Vars):
 *   TELEGRAM_TOKEN          — token do bot (BotFather)
 *   TELEGRAM_WEBHOOK_SECRET — segredo aleatório para validar requests (opcional mas recomendado)
 *   SUPABASE_URL            — URL do projeto Supabase
 *   SUPABASE_SERVICE_KEY    — service_role key (sem restrição RLS)
 */
import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const TOKEN = process.env.TELEGRAM_TOKEN || ''
const TG    = `https://api.telegram.org/bot${TOKEN}`
const sb    = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
)

// ── Telegram API ──────────────────────────────────────────────────────────────
async function tg(method, params) {
  try {
    const r = await fetch(`${TG}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    return r.json()
  } catch (e) {
    console.error(`[tg] ${method}`, e)
    return null
  }
}

async function send(chatId, text, replyMarkup) {
  return tg('sendMessage', {
    chat_id: chatId, text, parse_mode: 'Markdown',
    ...(replyMarkup && { reply_markup: replyMarkup }),
  })
}

async function edit(chatId, msgId, text, replyMarkup) {
  return tg('editMessageText', {
    chat_id: chatId, message_id: msgId, text, parse_mode: 'Markdown',
    ...(replyMarkup && { reply_markup: replyMarkup }),
  })
}

async function answerCb(queryId) {
  return tg('answerCallbackQuery', { callback_query_id: queryId })
}

// ── Bot session state (Supabase em vez de dict em memória) ────────────────────
async function getWait(chatId) {
  const { data } = await sb.from('bot_sessions').select('*')
    .eq('chat_id', String(chatId)).maybeSingle()
  return data || {}
}

async function setWait(chatId, mode, taskId = null, extra = {}) {
  await sb.from('bot_sessions').upsert({
    chat_id: String(chatId),
    mode,
    task_id: taskId,
    extra: extra || {},
    updated_at: new Date().toISOString(),
  }, { onConflict: 'chat_id' })
}

async function clearWait(chatId) {
  await sb.from('bot_sessions').delete().eq('chat_id', String(chatId))
}

// ── Provider cache (por sessão Edge — warm quando possível) ───────────────────
const _provCache = new Map()
async function getProv(chatId) {
  const cid = String(chatId)
  const cached = _provCache.get(cid)
  if (cached && Date.now() - cached.ts < 300_000) return cached.p
  const { data } = await sb.from('providers').select('*')
    .eq('chat_id', cid).eq('active', 1).maybeSingle()
  _provCache.set(cid, { p: data, ts: Date.now() })
  return data
}

// ── Labels ────────────────────────────────────────────────────────────────────
const URG = { critica: '🚨 CRÍTICA', alta: '🔴 Alta', media: '🟡 Média', baixa: '🟢 Baixa' }
const STA = {
  pendente: '⏳ Pendente', em_andamento: '🔧 Em andamento',
  prestador_externo: '🏢 Prestador Externo Acionado',
  concluida: '✅ Concluída', cancelada: '❌ Cancelada',
}

function elapsedStr(m) {
  if (!m) return '–'
  const h = Math.floor(m / 60), mi = m % 60
  return h ? `${h}h ${mi}min` : `${mi}min`
}

function fmtDate(d) {
  if (!d) return '–'
  try {
    const s = String(d)
    const dt = new Date(s)
    if (s.includes('T')) {
      return dt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit' })
    }
    return dt.toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return String(d).slice(0, 10) }
}

function nowPtBR() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(', ', ' ')
}

function fmtShort(t) {
  const urg  = URG[t.urgency] || ''
  const sta  = STA[t.status]  || ''
  const sla  = fmtDate(t.sla_deadline)
  const pobs = t.provider_obs      ? '📌 ' : ''
  const pdat = t.provider_new_date ? '📅 ' : ''
  return `${urg} *#${t.id}* — ${t.title}\n   👤 ${t.assignee}  |  ⏱ Conclusão: *${sla}*\n   ${sta} ${pobs}${pdat}`
}

function fmtDetail(t) {
  return (
    `${URG[t.urgency] || ''} *Tarefa #${t.id}*\n━━━━━━━━━━━━━━━━━━\n` +
    `📋 *${t.title}*\n\n` +
    `📝 ${t.description || '–'}\n\n` +
    `👤 *Prestador:* ${t.assignee}\n` +
    `🏢 *Setor:* ${t.sector || '–'}\n` +
    `🏷 *Categoria:* ${t.category || '–'}\n\n` +
    `⏱ *Conclusão prevista (SLA):* *${fmtDate(t.sla_deadline)}*\n` +
    `⚡ *Urgência:* ${(t.urgency || '').toUpperCase()}\n` +
    `🔄 *Status:* ${STA[t.status] || ''}\n\n` +
    `🕐 *Iniciada:* ${fmtDate(t.started_at)}\n` +
    `✅ *Concluída:* ${fmtDate(t.completed_at)}\n` +
    `⏳ *Tempo total:* ${elapsedStr(t.elapsed_minutes)}\n\n` +
    `📌 *Obs interna:* ${t.notes || '–'}\n` +
    `💬 *Obs prestador:* ${t.provider_obs || '–'}\n` +
    (t.provider_new_date ? `📅 *Nova data proposta:* ${fmtDate(t.provider_new_date)}\n` : '')
  )
}

// ── Keyboards ──────────────────────────────────────────────────────────────────
function mainKb() {
  return {
    inline_keyboard: [
      [{ text: '📋 Minhas Tarefas',  callback_data: 'my_tasks' },
       { text: '🔧 Em Andamento',    callback_data: 'in_progress' }],
      [{ text: '🚨 Críticas',        callback_data: 'criticas' },
       { text: '⏰ Atrasadas',       callback_data: 'atrasadas' }],
      [{ text: '🔍 Buscar',          callback_data: 'search' },
       { text: '📊 Meu Desempenho', callback_data: 'stats' }],
      [{ text: '✅ Concluídas Hoje', callback_data: 'done_today' }],
    ],
  }
}

function taskKb(t) {
  const tid = t.id, st = t.status || ''
  const rows = []
  if (st === 'pendente')
    rows.push([{ text: '▶️ INICIAR AGORA', callback_data: `start:${tid}` }])
  if (st === 'em_andamento')
    rows.push([
      { text: '✅ FINALIZAR TAREFA',         callback_data: `done:${tid}` },
      { text: '🏢 Acionar Prestador Externo', callback_data: `extprov:${tid}` },
    ])
  if (st === 'prestador_externo')
    rows.push([{ text: '✅ FINALIZAR TAREFA', callback_data: `done:${tid}` }])
  if (!['cancelada', 'concluida'].includes(st)) {
    rows.push([
      { text: '💬 Observação',       callback_data: `obs:${tid}` },
      { text: '📷 Enviar Foto',      callback_data: `photo:${tid}` },
    ])
    rows.push([
      { text: '📅 Propor Nova Data', callback_data: `newdate:${tid}` },
      { text: '❌ Cancelar',         callback_data: `cancel:${tid}` },
    ])
  }
  rows.push([
    { text: '🔙 Minhas Tarefas', callback_data: 'my_tasks' },
    { text: '🏠 Menu',           callback_data: 'menu' },
  ])
  return { inline_keyboard: rows }
}

function backMenuKb() {
  return { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu' }]] }
}

// ── Tasks query ───────────────────────────────────────────────────────────────
async function getTasks({ provId, companyId, status, urgency, overdue, search } = {}) {
  let q = sb.from('tasks').select('*')
  if (companyId) q = q.eq('company_id', companyId)
  if (provId)    q = q.eq('assignee_id', provId)
  if (Array.isArray(status)) q = q.in('status', status)
  else if (status) q = q.eq('status', status)
  if (urgency) q = q.eq('urgency', urgency)
  if (overdue) {
    q = q.lt('sla_deadline', new Date().toISOString())
         .neq('status', 'concluida')
         .neq('status', 'cancelada')
  }
  if (search) {
    q = q.or(`title.ilike.%${search}%,description.ilike.%${search}%,requester.ilike.%${search}%`)
  }
  const { data } = await q
  const ord = { critica: 0, alta: 1, media: 2, baixa: 3 }
  return (data || []).sort((a, b) =>
    (ord[a.urgency] ?? 4) - (ord[b.urgency] ?? 4) || b.id - a.id
  )
}

async function updateTask(taskId, chatId, fields) {
  const { data: existing } = await sb.from('tasks').select('*').eq('id', taskId).maybeSingle()
  if (!existing) return null
  const now = new Date().toISOString()
  const updates = { ...fields }
  if (fields.status) {
    if (fields.status === 'em_andamento' && !existing.started_at) {
      updates.started_at = now
      // SLA e prazo contam a partir do momento em que o colaborador inicia
      const SLA_H = { critica: 2, alta: 8, media: 24, baixa: 72 }
      const hours = SLA_H[existing.urgency] ?? 24
      const newSla = new Date(Date.now() + hours * 3600000).toISOString()
      updates.sla_deadline = newSla
      // Usa fuso SP para não gravar data UTC do dia seguinte em aprovações vespertinas
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
      updates.due_date = fmt.format(new Date(newSla))
    }
    if (fields.status === 'concluida') {
      updates.completed_at = now
      if (existing.started_at) {
        const elapsed = Math.round((Date.now() - new Date(existing.started_at).getTime()) / 60000)
        updates.elapsed_minutes = elapsed
      }
    }
  }
  await sb.from('tasks').update(updates).eq('id', taskId)
  // History
  for (const [k, v] of Object.entries(fields)) {
    if (String(existing[k] ?? '') !== String(v ?? '')) {
      await sb.from('task_history').insert({
        task_id: taskId, action: k,
        old_value: String(existing[k] ?? ''),
        new_value: String(v ?? ''),
        changed_by: `tg:${chatId}`,
      })
    }
  }
  const { data: updated } = await sb.from('tasks').select('*').eq('id', taskId).maybeSingle()
  return updated
}

// ── Show task list ────────────────────────────────────────────────────────────
async function showList(chatId, msgId, tasks, title) {
  if (!tasks.length) {
    return edit(chatId, msgId, `*${title}*\n\n_Nenhuma tarefa encontrada._`, backMenuKb())
  }
  let msg = `*${title}* — ${tasks.length} tarefa(s)\n━━━━━━━━━━━━━━━━\n`
  const btns = []
  for (const t of tasks.slice(0, 8)) {
    msg += fmtShort(t) + '\n\n'
    const urgIcon = (URG[t.urgency] || '').slice(0, 2)
    const stIcon  = t.status === 'em_andamento' ? '🔧' : t.status === 'prestador_externo' ? '🏢' : '⏳'
    btns.push([{ text: `${urgIcon}${stIcon} #${t.id} — ${t.title.slice(0, 28)}`, callback_data: `view:${t.id}` }])
  }
  btns.push([{ text: '🔙 Menu', callback_data: 'menu' }])
  return edit(chatId, msgId, msg, { inline_keyboard: btns })
}

// ── Handler: /start ───────────────────────────────────────────────────────────
async function handleStart(chatId, user, args) {
  await clearWait(chatId)
  _provCache.delete(String(chatId))

  const rawParam = args?.[0]?.trim()
  let inviteCode = null, directProvId = null
  if (rawParam) {
    if (rawParam.includes('_')) {
      const [ic, pid] = rawParam.split('_', 2)
      inviteCode    = ic
      directProvId  = /^\d+$/.test(pid) ? parseInt(pid) : null
    } else {
      inviteCode = rawParam
    }
  }

  // Case 1: link direto com provider_id embutido
  if (directProvId) {
    const { data: p } = await sb.from('providers').select('*')
      .eq('id', directProvId).eq('active', 1).maybeSingle()
    if (p) {
      await sb.from('providers').update({ chat_id: String(chatId) }).eq('id', p.id)
      _provCache.delete(String(chatId))
      return send(chatId,
        `✅ Vinculado com sucesso!\n\n👷 Olá, *${p.name}*!\n🏢 Setor: ${p.sector || '–'}\n\nVocê receberá notificações das suas tarefas por aqui. Escolha uma opção:`,
        mainKb())
    }
  }

  // Case 2: já vinculado
  const prov = await getProv(chatId)
  if (prov) {
    return send(chatId,
      `👷 Olá, *${prov.name}*!\n🏢 Setor: ${prov.sector || '–'}\n\nEscolha uma opção:`,
      mainKb())
  }

  // Case 3: resolve invite_code → company_id
  let inviteCompanyId = null
  if (inviteCode) {
    const { data: co } = await sb.from('companies').select('id')
      .eq('invite_code', inviteCode).eq('active', true).maybeSingle()
    inviteCompanyId = co?.id
  }

  // Tenta vincular pelo nome do Telegram
  const fn = (user.first_name || '').trim()
  const ln = (user.last_name  || '').trim()
  for (const nm of [`${fn} ${ln}`.trim(), fn, ln].filter(Boolean)) {
    let q = sb.from('providers').select('*').ilike('name', `%${nm}%`).eq('active', 1)
    if (inviteCompanyId) q = q.eq('company_id', inviteCompanyId)
    const { data: p } = await q.limit(1).maybeSingle()
    if (p) {
      await sb.from('providers').update({ chat_id: String(chatId) }).eq('id', p.id)
      _provCache.delete(String(chatId))
      return send(chatId,
        `✅ Vinculado com sucesso!\n\n👷 Olá, *${p.name}*!\nEscolha uma opção:`,
        mainKb())
    }
  }

  // Não encontrado — pede nome
  await setWait(chatId, 'name', null, inviteCode ? { invite_code: inviteCode } : {})
  return send(chatId,
    '👷 Bem-vindo ao *DespachaApp*!\n\nDigite seu *nome completo* exatamente como cadastrado no sistema:')
}

// ── Handler: button callbacks ─────────────────────────────────────────────────
async function handleCallback(chatId, msgId, queryId, data) {
  await answerCb(queryId)
  await clearWait(chatId)

  // Menu
  if (data === 'menu') {
    const prov = await getProv(chatId)
    return edit(chatId, msgId, `👷 *${prov?.name || 'Prestador'}* — Menu Principal:`, mainKb())
  }

  // Listas de tarefas
  if (data === 'my_tasks') {
    const prov = await getProv(chatId)
    if (!prov) return edit(chatId, msgId, '❌ Prestador não vinculado. Use /start.')

    // Janela de datas em fuso SP: hoje + amanhã; se amanhã for sábado, inclui segunda também
    const spFmt = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
    const now  = new Date()
    const tmr  = new Date(now); tmr.setDate(tmr.getDate() + 1)
    const dateWindow = [spFmt(now), spFmt(tmr)]
    // Dia da semana de amanhã via partes da data SP (0=Dom … 6=Sáb)
    const [ty, tm, td] = spFmt(tmr).split('-').map(Number)
    const tmrDow = new Date(Date.UTC(ty, tm - 1, td)).getUTCDay()
    if (tmrDow === 6) { // amanhã é sábado → inclui segunda-feira
      const mon = new Date(now); mon.setDate(mon.getDate() + 3)
      dateWindow.push(spFmt(mon))
    }

    const all   = await getTasks({ provId: prov.id, companyId: prov.company_id, status: ['pendente', 'em_andamento', 'prestador_externo'] })
    const tasks = all.filter(t =>
      ['em_andamento', 'prestador_externo'].includes(t.status) ||
      dateWindow.includes((t.due_date || '').slice(0, 10))
    )
    const label = dateWindow.length === 3
      ? `📋 Hoje, Amanhã e Segunda (${tasks.length})`
      : `📋 Hoje e Amanhã (${tasks.length})`
    return showList(chatId, msgId, tasks, label)
  }

  if (data === 'in_progress') {
    const prov = await getProv(chatId)
    if (!prov) return edit(chatId, msgId, '❌ Prestador não vinculado.')
    const tasks = await getTasks({ provId: prov.id, companyId: prov.company_id, status: ['em_andamento', 'prestador_externo'] })
    return showList(chatId, msgId, tasks, '🔧 Em Andamento')
  }

  if (data === 'criticas') {
    const prov = await getProv(chatId)
    if (!prov) return edit(chatId, msgId, '❌ Prestador não vinculado.')
    const tasks = (await getTasks({ provId: prov.id, companyId: prov.company_id, urgency: 'critica' }))
      .filter(t => !['concluida', 'cancelada'].includes(t.status))
    return showList(chatId, msgId, tasks, '🚨 Tarefas Críticas')
  }

  if (data === 'atrasadas') {
    const prov = await getProv(chatId)
    if (!prov) return edit(chatId, msgId, '❌ Prestador não vinculado.')
    const tasks = await getTasks({ provId: prov.id, companyId: prov.company_id, overdue: true })
    return showList(chatId, msgId, tasks, '⏰ Tarefas Atrasadas')
  }

  if (data === 'done_today') {
    const prov = await getProv(chatId)
    if (!prov) return edit(chatId, msgId, '❌ Prestador não vinculado.')
    const today = new Date().toISOString().slice(0, 10)
    const tasks = (await getTasks({ provId: prov.id, companyId: prov.company_id, status: 'concluida' }))
      .filter(t => (t.completed_at || '').startsWith(today))
    return showList(chatId, msgId, tasks, `✅ Concluídas Hoje (${tasks.length})`)
  }

  // Estatísticas
  if (data === 'stats') {
    const prov = await getProv(chatId)
    if (!prov) return edit(chatId, msgId, '❌ Prestador não encontrado.')
    const [mineTasks, globalTasks] = await Promise.all([
      getTasks({ provId: prov.id, companyId: prov.company_id }),
      getTasks({ companyId: prov.company_id }),
    ])
    const today = new Date().toISOString().slice(0, 10)
    const finMine = mineTasks.filter(t => t.elapsed_minutes)
    const finGlob = globalTasks.filter(t => t.elapsed_minutes)
    const mine = {
      total:      mineTasks.length,
      concluidas: mineTasks.filter(t => t.status === 'concluida').length,
      andamento:  mineTasks.filter(t => t.status === 'em_andamento').length,
      atrasadas:  mineTasks.filter(t => t.due_date && t.due_date < today && !['concluida','cancelada'].includes(t.status)).length,
      avg_min:    finMine.length ? Math.round(finMine.reduce((a, t) => a + t.elapsed_minutes, 0) / finMine.length) : null,
    }
    const geral = {
      concluida:   globalTasks.filter(t => t.status === 'concluida').length,
      pendente:    globalTasks.filter(t => t.status === 'pendente').length,
      avg_minutes: finGlob.length ? Math.round(finGlob.reduce((a, t) => a + t.elapsed_minutes, 0) / finGlob.length) : null,
    }
    const msg = (
      `📊 *Meu Desempenho — ${prov.name}*\n━━━━━━━━━━━━━━━━\n` +
      `📦 Total: *${mine.total}*\n✅ Concluídas: *${mine.concluidas}*\n` +
      `🔧 Em andamento: *${mine.andamento}*\n⏰ Atrasadas: *${mine.atrasadas}*\n` +
      `⏱ Tempo médio: *${elapsedStr(mine.avg_min)}*\n\n` +
      `*📈 Geral da equipe:*\n` +
      `✅ ${geral.concluida} concluídas | ⏳ ${geral.pendente} pendentes\n` +
      `⏱ Média global: ${elapsedStr(geral.avg_minutes)}`
    )
    return edit(chatId, msgId, msg, backMenuKb())
  }

  // Busca
  if (data === 'search') {
    await setWait(chatId, 'search')
    return edit(chatId, msgId, '🔍 *Buscar tarefa*\n\nDigite parte do título, solicitante ou descrição:')
  }

  // Visualizar tarefa
  if (data.startsWith('view:')) {
    const tid = parseInt(data.split(':')[1])
    const { data: task } = await sb.from('tasks').select('*').eq('id', tid).maybeSingle()
    if (!task) return edit(chatId, msgId, '❌ Tarefa não encontrada.')
    return edit(chatId, msgId, fmtDetail(task), taskKb(task))
  }

  // Iniciar tarefa
  if (data.startsWith('start:')) {
    const tid  = parseInt(data.split(':')[1])
    const task = await updateTask(tid, chatId, { status: 'em_andamento' })
    if (!task) return edit(chatId, msgId, '❌ Tarefa não encontrada.')
    return edit(chatId, msgId,
      `▶️ *Tarefa #${tid} INICIADA!*\n\n📋 ${task.title}\n⏱ *Conclusão prevista:* ${fmtDate(task.sla_deadline)}\n🕐 Início: ${fmtDate(task.started_at)}\n\n_O tempo de execução está sendo medido._`,
      { inline_keyboard: [
        [{ text: '✅ FINALIZAR AGORA', callback_data: `done:${tid}` }],
        [{ text: '💬 Observação', callback_data: `obs:${tid}` }, { text: '📅 Nova Data', callback_data: `newdate:${tid}` }],
        [{ text: '🔙 Minhas Tarefas', callback_data: 'my_tasks' }],
      ]})
  }

  // Concluir tarefa
  if (data.startsWith('done:')) {
    const tid  = parseInt(data.split(':')[1])
    const task = await updateTask(tid, chatId, { status: 'concluida' })
    if (!task) return edit(chatId, msgId, '❌ Tarefa não encontrada.')
    return edit(chatId, msgId,
      `✅ *Tarefa #${tid} CONCLUÍDA!*\n\n📋 ${task.title}\n\n🕐 Iniciada:  ${fmtDate(task.started_at)}\n🏁 Concluída: ${fmtDate(task.completed_at)}\n⏱ *Tempo total: ${elapsedStr(task.elapsed_minutes)}*`,
      { inline_keyboard: [[
        { text: '📋 Minhas Tarefas', callback_data: 'my_tasks' },
        { text: '🏠 Menu',           callback_data: 'menu' },
      ]]})
  }

  // Cancelar tarefa
  if (data.startsWith('cancel:')) {
    const tid = parseInt(data.split(':')[1])
    await updateTask(tid, chatId, { status: 'cancelada' })
    return edit(chatId, msgId, `❌ Tarefa #${tid} cancelada.`, backMenuKb())
  }

  // Acionar prestador externo
  if (data.startsWith('extprov:')) {
    const tid  = parseInt(data.split(':')[1])
    const task = await updateTask(tid, chatId, { status: 'prestador_externo' })
    if (!task) return edit(chatId, msgId, '❌ Tarefa não encontrada.')
    return edit(chatId, msgId,
      `🏢 *Prestador externo acionado — Tarefa #${tid}*\n\n📋 ${task.title}\n\n_O solicitante verá o status "Prestador externo solicitado" na consulta pública._`,
      { inline_keyboard: [
        [{ text: '✅ FINALIZAR TAREFA', callback_data: `done:${tid}` }],
        [{ text: '💬 Observação', callback_data: `obs:${tid}` }, { text: '📷 Enviar Foto', callback_data: `photo:${tid}` }],
        [{ text: '🔙 Minhas Tarefas', callback_data: 'my_tasks' }],
      ]})
  }

  // Observação
  if (data.startsWith('obs:')) {
    const tid = parseInt(data.split(':')[1])
    await setWait(chatId, 'obs', tid)
    return edit(chatId, msgId,
      `💬 *Observação — Tarefa #${tid}*\n\nDigite sua observação. Ela ficará visível para o gestor no sistema web:`,
      { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: `view:${tid}` }]] })
  }

  // Foto
  if (data.startsWith('photo:')) {
    const tid = parseInt(data.split(':')[1])
    await setWait(chatId, 'photo', tid)
    return edit(chatId, msgId,
      `📷 *Enviar Foto — Tarefa #${tid}*\n\nEnvie a foto agora. Você pode adicionar legenda junto com a foto.`,
      { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: `view:${tid}` }]] })
  }

  // Nova data
  if (data.startsWith('newdate:')) {
    const tid = parseInt(data.split(':')[1])
    const { data: task } = await sb.from('tasks').select('sla_deadline').eq('id', tid).maybeSingle()
    await setWait(chatId, 'newdate', tid)
    return edit(chatId, msgId,
      `📅 *Propor Nova Data — Tarefa #${tid}*\n\n⏱ Data atual (SLA): *${fmtDate(task?.sla_deadline)}*\n\nDigite a nova data proposta no formato:\n*DD/MM/AAAA*\n\n_Ex: 25/12/2025_`,
      { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: `view:${tid}` }]] })
  }
}

// ── Handler: mensagens de texto ───────────────────────────────────────────────
async function handleText(chatId, user, text) {
  const wait = await getWait(chatId)
  const mode = wait.mode

  // Vinculação por nome
  if (mode === 'name') {
    const savedInvite = wait.extra?.invite_code
    await clearWait(chatId)
    const name = text.trim()
    let inviteCompanyId = null
    if (savedInvite) {
      const { data: co } = await sb.from('companies').select('id')
        .eq('invite_code', savedInvite).eq('active', true).maybeSingle()
      inviteCompanyId = co?.id
    }
    let q = sb.from('providers').select('*').ilike('name', `%${name}%`).eq('active', 1)
    if (inviteCompanyId) q = q.eq('company_id', inviteCompanyId)
    const { data: p } = await q.limit(1).maybeSingle()
    if (p) {
      await sb.from('providers').update({ chat_id: String(chatId) }).eq('id', p.id)
      _provCache.delete(String(chatId))
      return send(chatId, `✅ Vinculado como *${p.name}*!\n\nEscolha uma opção:`, mainKb())
    } else {
      await setWait(chatId, 'name', null, savedInvite ? { invite_code: savedInvite } : {})
      return send(chatId, `❌ *'${name}'* não encontrado no sistema.\nVerifique o nome e tente novamente:`)
    }
  }

  // Busca
  if (mode === 'search') {
    await clearWait(chatId)
    const prov  = await getProv(chatId)
    const term  = text.trim()
    const tasks = await getTasks({ provId: prov?.id, companyId: prov?.company_id, search: term })
    let msg = `🔍 *'${term}'* — ${tasks.length} resultado(s)\n━━━━━━━━━━━━━━━━\n`
    const btns = []
    for (const t of tasks.slice(0, 8)) {
      msg += fmtShort(t) + '\n\n'
      btns.push([{ text: `#${t.id} ${t.title.slice(0, 32)}`, callback_data: `view:${t.id}` }])
    }
    btns.push([{ text: '🔙 Menu', callback_data: 'menu' }])
    return send(chatId, msg, { inline_keyboard: btns })
  }

  // Observação
  if (mode === 'obs') {
    await clearWait(chatId)
    const tid = wait.task_id
    if (!tid) return send(chatId, '❌ Tarefa não encontrada.')
    const { data: task } = await sb.from('tasks').select('*').eq('id', tid).maybeSingle()
    if (!task) return send(chatId, '❌ Tarefa não encontrada.')
    const prov    = await getProv(chatId)
    const name    = prov?.name || 'Prestador'
    const nowStr  = nowPtBR()
    const novaObs = `[${nowStr}] ${name}: ${text.trim()}`
    const obsAnt  = task.provider_obs || ''
    const obsFinal = obsAnt ? `${obsAnt}\n${novaObs}` : novaObs
    await Promise.all([
      sb.from('tasks').update({ provider_obs: obsFinal }).eq('id', tid),
      sb.from('task_history').insert({ task_id: tid, action: 'observacao_prestador',
        old_value: '', new_value: novaObs, changed_by: `tg:${name}` }),
    ])
    return send(chatId,
      `💬 *Observação salva na tarefa #${tid}!*\n\n_${novaObs}_`,
      { inline_keyboard: [[
        { text: '👁 Ver tarefa', callback_data: `view:${tid}` },
        { text: '🏠 Menu',       callback_data: 'menu' },
      ]]})
  }

  // Nova data
  if (mode === 'newdate') {
    const tid = wait.task_id
    if (!tid) { await clearWait(chatId); return send(chatId, '❌ Tarefa não encontrada.') }
    const { data: task } = await sb.from('tasks').select('*').eq('id', tid).maybeSingle()
    if (!task) { await clearWait(chatId); return send(chatId, '❌ Tarefa não encontrada.') }
    const match = text.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (!match) {
      return send(chatId, '❌ Formato inválido. Use *DD/MM/AAAA*\nEx: 25/12/2025')
    }
    await clearWait(chatId)
    const newDate = `${match[3]}-${match[2]}-${match[1]}`
    const prov = await getProv(chatId)
    const name = prov?.name || 'Prestador'
    await Promise.all([
      sb.from('tasks').update({ provider_new_date: newDate }).eq('id', tid),
      sb.from('task_history').insert({ task_id: tid, action: 'proposta_nova_data',
        old_value: String(task.due_date || ''), new_value: newDate, changed_by: `tg:${name}` }),
    ])
    return send(chatId,
      `📅 *Nova data proposta para #${tid}!*\n\nData: *${text.trim()}*\n\n_O gestor verá no sistema e poderá aprovar ou recusar._`,
      { inline_keyboard: [[
        { text: '👁 Ver tarefa', callback_data: `view:${tid}` },
        { text: '🏠 Menu',       callback_data: 'menu' },
      ]]})
  }

  // Fallback
  return handleStart(chatId, user, [])
}

// ── Handler: fotos ────────────────────────────────────────────────────────────
async function handlePhoto(chatId, photos, caption) {
  const wait = await getWait(chatId)
  if (wait.mode !== 'photo') {
    return send(chatId, 'Use /start e selecione uma tarefa para enviar fotos.')
  }
  await clearWait(chatId)
  const tid = wait.task_id
  if (!tid) return send(chatId, '❌ Tarefa não encontrada.')
  const { data: task } = await sb.from('tasks').select('*').eq('id', tid).maybeSingle()
  if (!task) return send(chatId, '❌ Tarefa não encontrada.')

  await send(chatId, '⏳ Processando foto…')
  try {
    // Maior resolução = último elemento
    const photoObj = photos[photos.length - 1]
    const fileRes  = await fetch(`${TG}/getFile?file_id=${photoObj.file_id}`)
    const fileData = await fileRes.json()
    const filePath = fileData.result?.file_path
    if (!filePath) throw new Error('Não foi possível obter o arquivo da foto')

    const imgRes = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${filePath}`)
    const imgBuf = await imgRes.arrayBuffer()
    const bytes  = new Uint8Array(imgBuf)

    // Base64 em chunks para não estourar a stack
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    }
    const dataUrl = `data:image/jpeg;base64,${btoa(binary)}`

    let existing = []
    try { if (task.photos) existing = JSON.parse(task.photos) } catch {}
    existing.push(dataUrl)

    const updates = { photos: JSON.stringify(existing) }

    if (caption) {
      const prov   = await getProv(chatId)
      const name   = prov?.name || 'Prestador'
      const nowStr = nowPtBR()
      const novaObs = `[${nowStr}] ${name} (foto): ${caption}`
      const obsAnt  = task.provider_obs || ''
      updates.provider_obs = obsAnt ? `${obsAnt}\n${novaObs}` : novaObs
    }

    await Promise.all([
      sb.from('tasks').update(updates).eq('id', tid),
      sb.from('task_history').insert({ task_id: tid, action: 'foto_prestador',
        old_value: '', new_value: 'Foto adicionada via Telegram', changed_by: `tg:${chatId}` }),
    ])
    return send(chatId,
      `📷 *Foto adicionada à tarefa #${tid}!*`,
      { inline_keyboard: [[
        { text: '👁 Ver tarefa', callback_data: `view:${tid}` },
        { text: '🏠 Menu',       callback_data: 'menu' },
      ]]})
  } catch (e) {
    console.error('[photo]', e)
    return send(chatId, `❌ Erro ao processar foto: ${e.message}`)
  }
}

// ── Main edge handler ─────────────────────────────────────────────────────────
export default async function handler(req) {
  // GET: health check
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ ok: true, bot: 'DespachaApp', mode: 'webhook' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Verifica segredo (opcional — configure TELEGRAM_WEBHOOK_SECRET no Vercel)
  const secret = req.headers.get('x-telegram-bot-api-secret-token')
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  let update
  try { update = await req.json() } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  // Responde 200 imediatamente (Telegram exige < 60s, Vercel Hobby = 10s)
  // Processamento síncrono dentro da mesma execução
  try {
    if (update.message) {
      const msg    = update.message
      const chatId = msg.chat.id
      const user   = msg.from || {}

      if (msg.photo) {
        await handlePhoto(chatId, msg.photo, msg.caption || null)
      } else if (msg.text) {
        const text = msg.text
        if (text.startsWith('/start')) {
          await handleStart(chatId, user, text.split(' ').slice(1))
        } else if (text === '/menu' || text.startsWith('/menu@')) {
          await handleStart(chatId, user, [])
        } else if (text === '/cancel' || text.startsWith('/cancel@')) {
          await clearWait(chatId)
          await send(chatId, '❌ Cancelado. Use /start para recomeçar.')
        } else {
          await handleText(chatId, user, text)
        }
      }
    } else if (update.callback_query) {
      const cq     = update.callback_query
      const chatId = cq.message?.chat?.id
      const msgId  = cq.message?.message_id
      if (chatId) await handleCallback(chatId, msgId, cq.id, cq.data)
    }
  } catch (e) {
    console.error('[webhook error]', e)
  }

  return new Response('ok', { status: 200 })
}
