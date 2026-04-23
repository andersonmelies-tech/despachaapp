import { authenticate, ok, err, CORS_HEADERS } from './_auth.js'

export const config = { runtime: 'edge' }

function isOverdue(task) {
  if (['concluida', 'cancelada'].includes(task.status)) return false
  const now = new Date()
  const due = task.due_date     ? new Date(task.due_date)     : null
  const sla = task.sla_deadline ? new Date(task.sla_deadline) : null
  return (due && due < now) || (sla && sla < now)
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const auth = await authenticate(request)
  if (auth instanceof Response) return auth
  const { company, supabase } = auth

  if (request.method === 'GET') {
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('status, urgency, elapsed_minutes, due_date, sla_deadline, completed_at')
      .eq('company_id', company.id)

    if (error) return err(error.message)

    const all        = tasks || []
    const total      = all.length
    const pendente   = all.filter(t => t.status === 'pendente').length
    const em_andamento = all.filter(t => t.status === 'em_andamento').length
    const concluida  = all.filter(t => t.status === 'concluida').length
    const cancelada  = all.filter(t => t.status === 'cancelada').length
    const atrasadas  = all.filter(t => isOverdue(t)).length

    const finished   = all.filter(t => t.elapsed_minutes)
    const avg_minutes = finished.length
      ? Math.round(finished.reduce((a, t) => a + t.elapsed_minutes, 0) / finished.length)
      : 0

    // SLA compliance
    const withSla = all.filter(t => t.sla_deadline && ['concluida', 'cancelada'].includes(t.status))
    const slaOk   = withSla.filter(t => {
      if (!t.completed_at || !t.sla_deadline) return false
      return new Date(t.completed_at) <= new Date(t.sla_deadline)
    }).length
    const sla_compliance_pct = withSla.length
      ? Math.round((slaOk / withSla.length) * 100)
      : 100

    return ok({
      total,
      pendente,
      em_andamento,
      concluida,
      cancelada,
      atrasadas,
      avg_minutes,
      sla_compliance_pct,
    })
  }

  return err('Method not allowed', 405)
}
