import { authenticate, ok, err, CORS_HEADERS } from './_auth.js'

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const auth = await authenticate(request)
  if (auth instanceof Response) return auth
  const { company, supabase } = auth

  if (request.method === 'GET') {
    const { data, error } = await supabase
      .from('providers')
      .select('id, name, sector, active, chat_id')
      .eq('company_id', company.id)
      .eq('active', 1)
      .order('name')

    if (error) return err(error.message)
    return ok(data || [])
  }

  return err('Method not allowed', 405)
}
