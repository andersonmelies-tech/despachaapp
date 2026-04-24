import { authenticate, ok, err, CORS_HEADERS } from './_auth.js'

export const config = { runtime: 'edge' }

export default async function handler(request) {
  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const auth = await authenticate(request)
  if (auth instanceof Response) return auth
  const { company, supabase } = auth

  // ── GET /api/v1/tasks ──────────────────────────────────────────────────────
  if (request.method === 'GET') {
    const url = new URL(request.url)
    const p   = url.searchParams

    const status      = p.get('status')
    const urgency     = p.get('urgency')
    const assignee_id = p.get('assignee_id')
    const due_from    = p.get('due_from')
    const due_to      = p.get('due_to')
    const limit       = Math.min(parseInt(p.get('limit') || '50', 10), 100)
    const offset      = parseInt(p.get('offset') || '0', 10)

    let query = supabase
      .from('tasks')
      .select('*', { count: 'exact' })
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status)      query = query.eq('status', status)
    if (urgency)     query = query.eq('urgency', urgency)
    if (assignee_id) query = query.eq('assignee_id', assignee_id)
    if (due_from)    query = query.gte('due_date', due_from)
    if (due_to)      query = query.lte('due_date', due_to + 'T23:59:59')

    const { data, error, count } = await query
    if (error) return err(error.message)

    return new Response(JSON.stringify({ success: true, data: data || [], total: count ?? 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    })
  }

  // ── POST /api/v1/tasks ─────────────────────────────────────────────────────
  if (request.method === 'POST') {
    let body
    try { body = await request.json() }
    catch { return err('Invalid JSON body') }

    const { title, description, requester, assignee_id, sector, urgency, due_date, client_name, client_address } = body

    if (!title)     return err('Field "title" is required')
    if (!requester) return err('Field "requester" is required')
    if (!urgency)   return err('Field "urgency" is required')

    const VALID_URGENCY = ['critica', 'alta', 'media', 'baixa']
    if (!VALID_URGENCY.includes(urgency)) {
      return err(`Field "urgency" must be one of: ${VALID_URGENCY.join(', ')}`)
    }

    const payload = {
      title,
      description: description || null,
      requester,
      assignee_id:  assignee_id || null,
      sector:       sector || null,
      urgency,
      due_date:      due_date || null,
      status:        'pendente',
      company_id:    company.id,
      client_name:   client_name || null,
      client_address: client_address || null,
    }

    const { data, error } = await supabase.from('tasks').insert(payload).select().single()
    if (error) return err(error.message)

    return new Response(JSON.stringify({ success: true, data }), {
      status: 201,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    })
  }

  return err('Method not allowed', 405)
}
