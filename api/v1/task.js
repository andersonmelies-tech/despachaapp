import { authenticate, ok, err, CORS_HEADERS } from './_auth.js'

export const config = { runtime: 'edge' }

const ALLOWED_PATCH_FIELDS = ['status', 'assignee_id', 'due_date', 'notes', 'client_name', 'client_address']
const VALID_STATUSES = ['pendente', 'em_andamento', 'concluida', 'cancelada']

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const auth = await authenticate(request)
  if (auth instanceof Response) return auth
  const { company, supabase } = auth

  const url = new URL(request.url)
  const id  = url.searchParams.get('id')

  if (!id) return err('Query param "id" is required')

  // ── GET /api/v1/task?id=UUID ───────────────────────────────────────────────
  if (request.method === 'GET') {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', id)
      .eq('company_id', company.id)
      .single()

    if (error || !data) return err('Task not found', 404)
    return ok(data)
  }

  // ── PATCH /api/v1/task?id=UUID ─────────────────────────────────────────────
  if (request.method === 'PATCH') {
    let body
    try { body = await request.json() }
    catch { return err('Invalid JSON body') }

    // Filter to allowed fields only
    const updates = {}
    for (const field of ALLOWED_PATCH_FIELDS) {
      if (body[field] !== undefined) updates[field] = body[field]
    }

    if (Object.keys(updates).length === 0) {
      return err(`No updatable fields provided. Allowed: ${ALLOWED_PATCH_FIELDS.join(', ')}`)
    }

    if (updates.status && !VALID_STATUSES.includes(updates.status)) {
      return err(`Field "status" must be one of: ${VALID_STATUSES.join(', ')}`)
    }

    // Auto-set timestamps
    if (updates.status === 'concluida' && !updates.completed_at) {
      updates.completed_at = new Date().toISOString()
    }
    if (updates.status === 'em_andamento' && !updates.started_at) {
      updates.started_at = new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .eq('company_id', company.id)
      .select()
      .single()

    if (error) return err(error.message)
    if (!data) return err('Task not found or not updated', 404)

    return ok(data)
  }

  return err('Method not allowed', 405)
}
