export const config = { runtime: 'edge' }

import { createClient } from '@supabase/supabase-js'

function buildHtml({ companyName, total, concluded, inProgress, overdue, lateRate, topProviders }) {
  const accent = '#3B82F6'
  const bg     = '#0f172a'
  const card   = '#1e293b'
  const border = '#334155'
  const text   = '#f1f5f9'
  const muted  = '#94a3b8'

  const providerRows = topProviders.map((p, i) =>
    `<tr>
      <td style="padding:10px 16px;color:${muted};font-family:monospace;font-size:13px;">${i + 1}.</td>
      <td style="padding:10px 16px;color:${text};font-weight:600;">${p.name}</td>
      <td style="padding:10px 16px;color:${accent};font-weight:700;text-align:right;">${p.count} concluídas</td>
    </tr>`
  ).join('')

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Relatório Semanal — ${companyName}</title>
</head>
<body style="margin:0;padding:0;background:${bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${bg};padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:${card};border-radius:16px 16px 0 0;border:1px solid ${border};border-bottom:none;padding:32px 40px;text-align:center;">
            <div style="font-size:28px;font-weight:800;color:${text};letter-spacing:-0.5px;">
              📊 Relatório Semanal
            </div>
            <div style="font-size:14px;color:${muted};margin-top:8px;">${companyName}</div>
            <div style="font-size:12px;color:${muted};margin-top:4px;">
              Últimos 7 dias — ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
            </div>
          </td>
        </tr>

        <!-- KPIs -->
        <tr>
          <td style="background:${card};border:1px solid ${border};border-top:none;border-bottom:none;padding:0 40px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:8px;" align="center">
                  <div style="background:#0f172a;border:1px solid ${border};border-radius:12px;padding:20px 16px;text-align:center;">
                    <div style="font-size:32px;font-weight:800;color:${accent};">${total}</div>
                    <div style="font-size:12px;color:${muted};margin-top:4px;text-transform:uppercase;letter-spacing:.08em;">Total</div>
                  </div>
                </td>
                <td style="padding:8px;" align="center">
                  <div style="background:#0f172a;border:1px solid ${border};border-radius:12px;padding:20px 16px;text-align:center;">
                    <div style="font-size:32px;font-weight:800;color:#10b981;">${concluded}</div>
                    <div style="font-size:12px;color:${muted};margin-top:4px;text-transform:uppercase;letter-spacing:.08em;">Concluídas</div>
                  </div>
                </td>
                <td style="padding:8px;" align="center">
                  <div style="background:#0f172a;border:1px solid ${border};border-radius:12px;padding:20px 16px;text-align:center;">
                    <div style="font-size:32px;font-weight:800;color:#f59e0b;">${inProgress}</div>
                    <div style="font-size:12px;color:${muted};margin-top:4px;text-transform:uppercase;letter-spacing:.08em;">Em Andamento</div>
                  </div>
                </td>
                <td style="padding:8px;" align="center">
                  <div style="background:#0f172a;border:1px solid ${border};border-radius:12px;padding:20px 16px;text-align:center;">
                    <div style="font-size:32px;font-weight:800;color:#ef4444;">${overdue}</div>
                    <div style="font-size:12px;color:${muted};margin-top:4px;text-transform:uppercase;letter-spacing:.08em;">Atrasadas</div>
                  </div>
                </td>
              </tr>
            </table>

            <!-- Late rate bar -->
            <div style="margin:16px 0 0;padding:16px;background:#0f172a;border-radius:10px;border:1px solid ${border};">
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span style="font-size:12px;color:${muted};text-transform:uppercase;letter-spacing:.08em;">Taxa de atraso</span>
                <span style="font-size:13px;font-weight:700;color:${lateRate > 20 ? '#ef4444' : lateRate > 10 ? '#f59e0b' : '#10b981'};">${lateRate}%</span>
              </div>
              <div style="background:${border};border-radius:4px;height:6px;overflow:hidden;">
                <div style="background:${lateRate > 20 ? '#ef4444' : lateRate > 10 ? '#f59e0b' : '#10b981'};width:${Math.min(lateRate, 100)}%;height:100%;border-radius:4px;"></div>
              </div>
            </div>
          </td>
        </tr>

        <!-- Top Providers -->
        ${topProviders.length > 0 ? `
        <tr>
          <td style="background:${card};border:1px solid ${border};border-top:none;border-bottom:none;padding:0 40px 24px;">
            <div style="font-size:13px;font-weight:700;color:${text};text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px;">🏆 Top Prestadores</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:10px;border:1px solid ${border};overflow:hidden;">
              <tbody>
                ${providerRows}
              </tbody>
            </table>
          </td>
        </tr>` : ''}

        <!-- CTA -->
        <tr>
          <td style="background:${card};border:1px solid ${border};border-top:none;border-radius:0 0 16px 16px;padding:28px 40px;text-align:center;">
            <a href="https://app.despachaapp.com.br"
              style="display:inline-block;background:${accent};color:#fff;font-weight:700;font-size:14px;text-decoration:none;padding:14px 32px;border-radius:10px;letter-spacing:.03em;">
              Abrir DespachaApp →
            </a>
            <div style="margin-top:20px;font-size:11px;color:${muted};">
              Você está recebendo este e-mail porque é administrador de <strong style="color:${text};">${companyName}</strong> no DespachaApp.<br/>
              <a href="https://app.despachaapp.com.br/settings" style="color:${accent};text-decoration:none;">Gerenciar preferências de e-mail</a>
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export default async function handler(req) {
  // Accept Vercel cron header or CRON_SECRET auth
  const cronHeader = req.headers.get('x-vercel-cron')
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  const isVercelCron = cronHeader === '1'
  const isSecretAuth = cronSecret && authHeader === `Bearer ${cronSecret}`

  if (!isVercelCron && !isSecretAuth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  )

  // Fetch active companies
  const { data: companies, error: compErr } = await supabase
    .from('companies')
    .select('id, name')
    .in('subscription_status', ['active', 'trialing'])

  if (compErr) {
    return new Response(JSON.stringify({ error: compErr.message }), { status: 500 })
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  let sent = 0

  for (const company of companies) {
    // Fetch config for this company (report_email)
    const { data: cfgRows } = await supabase
      .from('config')
      .select('key, value')
      .eq('company_id', company.id)
      .in('key', ['report_email', 'company_name'])

    const cfg = {}
    if (cfgRows) cfgRows.forEach(r => { cfg[r.key] = r.value })

    const email       = cfg.report_email || process.env.ADMIN_EMAIL
    const companyName = cfg.company_name || company.name || 'DespachaApp'

    if (!email) continue

    // Fetch task stats for last 7 days
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, status, assignee_id')
      .eq('company_id', company.id)
      .gte('created_at', sevenDaysAgo)

    const taskList  = tasks || []
    const total     = taskList.length
    const concluded = taskList.filter(t => t.status === 'concluida').length
    const inProgress = taskList.filter(t => t.status === 'andamento').length
    const overdue   = taskList.filter(t => t.status === 'atrasada').length
    const lateRate  = total > 0 ? Math.round((overdue / total) * 100) : 0

    // Top 3 providers by concluded tasks
    const providerCounts = {}
    taskList.filter(t => t.status === 'concluida' && t.assignee_id).forEach(t => {
      providerCounts[t.assignee_id] = (providerCounts[t.assignee_id] || 0) + 1
    })

    const topProviderIds = Object.entries(providerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id)

    let topProviders = []
    if (topProviderIds.length > 0) {
      const { data: provData } = await supabase
        .from('providers')
        .select('id, name')
        .in('id', topProviderIds)
      if (provData) {
        topProviders = topProviderIds.map(id => {
          const p = provData.find(x => x.id === id)
          return { name: p?.name || 'Prestador', count: providerCounts[id] }
        })
      }
    }

    const htmlContent = buildHtml({ companyName, total, concluded, inProgress, overdue, lateRate, topProviders })

    // Send via Resend REST API
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'DespachaApp <relatorios@despachaapp.com.br>',
        to: [email],
        subject: `📊 Relatório Semanal — ${companyName}`,
        html: htmlContent,
      }),
    })

    sent++
  }

  return new Response(
    JSON.stringify({ ok: true, companies: companies.length, sent }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
