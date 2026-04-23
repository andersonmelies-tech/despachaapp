// Shared auth helper for all API v1 endpoints
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL         = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

export function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'X-API-Key, Content-Type',
}

export function corsResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

export function ok(data, extra = {}) {
  const total = Array.isArray(data) ? data.length : undefined
  return corsResponse({ success: true, data, ...(total !== undefined ? { total } : {}), ...extra })
}

export function err(message, status = 400) {
  return corsResponse({ success: false, error: message }, status)
}

/**
 * Authenticate the request by reading X-API-Key and looking up the company.
 * Returns { company } on success, or a Response on failure.
 */
export async function authenticate(request) {
  const apiKey = request.headers.get('X-API-Key') || request.headers.get('x-api-key')
  if (!apiKey) return err('Missing X-API-Key header', 401)

  const supabase = getServiceClient()
  const { data: company, error } = await supabase
    .from('companies')
    .select('id, name, api_key')
    .eq('api_key', apiKey)
    .single()

  if (error || !company) return err('Invalid API key', 401)
  return { company, supabase }
}
