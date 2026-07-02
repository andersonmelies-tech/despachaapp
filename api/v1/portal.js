import { authenticate, ok, err, CORS_HEADERS } from './_auth.js'

export const config = { runtime: 'edge' }

const APP_URL = 'https://despachaapp.vercel.app'

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const auth = await authenticate(request)
  if (auth instanceof Response) return auth
  const { company, supabase } = auth

  const { data } = await supabase
    .from('companies')
    .select('invite_code, name')
    .eq('id', company.id)
    .single()

  if (!data?.invite_code) return err('invite_code não configurado para esta empresa', 404)

  const portal_url = `${APP_URL}/portal?c=${data.invite_code}`

  return ok({
    invite_code: data.invite_code,
    portal_url,
    company_name: data.name,
  })
}
