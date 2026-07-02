import { authenticate, ok, err, CORS_HEADERS } from './_auth.js'

export const config = { runtime: 'edge' }

const APP_URL = 'https://despachaapp.com.br'

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const auth = await authenticate(request)
  if (auth instanceof Response) return auth
  const { company, supabase } = auth

  const [{ data: co }, { data: cfg }] = await Promise.all([
    supabase.from('companies').select('invite_code, name').eq('id', company.id).single(),
    supabase.from('config').select('value').eq('key', 'brand_company_name').maybeSingle(),
  ])

  if (!co?.invite_code) return err('invite_code não configurado para esta empresa', 404)

  const portal_url   = `${APP_URL}/portal?c=${co.invite_code}`
  const company_name = cfg?.value || co.name

  return ok({
    invite_code: co.invite_code,
    portal_url,
    company_name,
  })
}
