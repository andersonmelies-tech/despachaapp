import { authenticate, ok, err, CORS_HEADERS } from './_auth.js'

const VALID_EVENTS  = ['task.create']
const VALID_URGENCY = ['critica', 'alta', 'media', 'baixa']

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const auth = await authenticate(request)
  if (auth instanceof Response) return auth
  const { company, supabase } = auth

  if (request.method === 'POST') {
    let body
    try { body = await request.json() }
    catch { return err('Invalid JSON body') }

    const { event, data } = body

    if (!event) return err('Field "event" is required')
    if (!VALID_EVENTS.includes(event)) {
      return err(`Unknown event "${event}". Supported events: ${VALID_EVENTS.join(', ')}`)
    }

    // ── event: task.create ────────────────────────────────────────────────────
    if (event === 'task.create') {
      if (!data || typeof data !== 'object') return err('Field "data" must be an object')

      const { title, description, requester, assignee_id, sector, urgency, due_date } = data

      if (!title)     return err('data.title is required')
      if (!requester) return err('data.requester is required')
      if (!urgency)   return err('data.urgency is required')
      if (!VALID_URGENCY.includes(urgency)) {
        return err(`data.urgency must be one of: ${VALID_URGENCY.join(', ')}`)
      }

      const payload = {
        title,
        description:  description || null,
        requester,
        assignee_id:  assignee_id || null,
        sector:       sector      || null,
        urgency,
        due_date:     due_date    || null,
        status:       'pendente',
        company_id:   company.id,
      }

      const { data: created, error } = await supabase
        .from('tasks')
        .insert(payload)
        .select()
        .single()

      if (error) return err(error.message)

      return new Response(JSON.stringify({ success: true, data: created }), {
        status: 201,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      })
    }
  }

  return err('Method not allowed', 405)
}
