const SB_URL     = (process.env.SUPABASE_URL          || '').trim()
const SB_ANON    = (process.env.SUPABASE_ANON_KEY     || '').trim()
const SB_SERVICE = (process.env.SUPABASE_SERVICE_KEY  || '').trim()

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

// Minimal REST helper — replaces createClient for edge-compatible DB access
export function makeDb() {
  const base = `${SB_URL}/rest/v1`
  const svcH = {
    apikey:         SB_SERVICE,
    Authorization:  `Bearer ${SB_SERVICE}`,
    'Content-Type': 'application/json',
    Prefer:         'return=representation',
  }

  return {
    from(table) {
      let _filters     = []
      let _select      = '*'
      let _order       = null
      let _rangeFrom   = null
      let _rangeTo     = null
      let _single      = false
      let _maybeSingle = false
      let _countExact  = false
      let _limit       = null

      const builder = {
        select(cols, opts = {}) {
          _select = cols || '*'
          if (opts.count === 'exact') _countExact = true
          return builder
        },
        eq(col, val)   { _filters.push(`${col}=eq.${encodeURIComponent(val)}`); return builder },
        neq(col, val)  { _filters.push(`${col}=neq.${encodeURIComponent(val)}`); return builder },
        gte(col, val)  { _filters.push(`${col}=gte.${encodeURIComponent(val)}`); return builder },
        lte(col, val)  { _filters.push(`${col}=lte.${encodeURIComponent(val)}`); return builder },
        lt(col, val)   { _filters.push(`${col}=lt.${encodeURIComponent(val)}`); return builder },
        gt(col, val)   { _filters.push(`${col}=gt.${encodeURIComponent(val)}`); return builder },
        ilike(col, val){ _filters.push(`${col}=ilike.${encodeURIComponent(val)}`); return builder },
        in(col, vals)  { _filters.push(`${col}=in.(${vals.join(',')})`); return builder },
        not(col, op, val) {
          _filters.push(`${col}=not.${op}.${encodeURIComponent(String(val))}`)
          return builder
        },
        or(expr)       { _filters.push(`or=(${expr})`); return builder },
        order(col, opts = {}) { _order = `${col}.${opts.ascending ? 'asc' : 'desc'}`; return builder },
        range(from, to) { _rangeFrom = from; _rangeTo = to; return builder },
        limit(n)       { _limit = n; return builder },
        single()       { _single = true; return builder },
        maybeSingle()  { _maybeSingle = true; return builder },

        async then(resolve, reject) {
          try {
            const params = [`select=${encodeURIComponent(_select)}`, ..._filters]
            if (_order) params.push(`order=${_order}`)
            if (_limit !== null && _rangeFrom === null) { _rangeFrom = 0; _rangeTo = _limit - 1 }
            const url = `${base}/${table}?${params.join('&')}`

            const h = { ...svcH }
            if (_rangeFrom !== null) h['Range'] = `${_rangeFrom}-${_rangeTo ?? ''}`
            if (_countExact) h['Prefer'] = 'count=exact'

            const r    = await fetch(url, { headers: h })
            const body = await r.json()

            let data  = body
            let count = null
            if (_countExact) {
              const cr = r.headers.get('Content-Range')
              if (cr) count = parseInt(cr.split('/')[1]) || 0
            }
            if (_single || _maybeSingle) data = Array.isArray(body) ? (body[0] || null) : body
            const error = r.ok ? null : { message: body?.message || body?.error || r.status }
            resolve({ data, error, count })
          } catch (e) { reject(e) }
        },

        // INSERT
        insert(payload) {
          const insertBuilder = {
            select() { return insertBuilder },
            single() { return insertBuilder },
            async then(resolve, reject) {
              try {
                const r    = await fetch(`${base}/${table}`, { method: 'POST', headers: svcH, body: JSON.stringify(payload) })
                const body = await r.json()
                const data = Array.isArray(body) ? body[0] : body
                const error = r.ok ? null : { message: body?.message || body?.error || r.status }
                resolve({ data, error })
              } catch (e) { reject(e) }
            }
          }
          return insertBuilder
        },

        // UPSERT
        upsert(payload, opts = {}) {
          const conflict = opts.onConflict ? `,resolution=merge-duplicates` : ''
          const upsertBuilder = {
            select() { return upsertBuilder },
            async then(resolve, reject) {
              try {
                const h = { ...svcH, Prefer: `return=representation${conflict}` }
                const r    = await fetch(`${base}/${table}`, { method: 'POST', headers: h, body: JSON.stringify(payload) })
                const body = await r.json()
                const data = Array.isArray(body) ? body[0] : body
                const error = r.ok ? null : { message: body?.message || body?.error || r.status }
                resolve({ data, error })
              } catch (e) { reject(e) }
            }
          }
          return upsertBuilder
        },

        // UPDATE
        update(payload) {
          const updateBuilder = {
            eq(col, val)  { _filters.push(`${col}=eq.${encodeURIComponent(val)}`); return updateBuilder },
            neq(col, val) { _filters.push(`${col}=neq.${encodeURIComponent(val)}`); return updateBuilder },
            lte(col, val) { _filters.push(`${col}=lte.${encodeURIComponent(val)}`); return updateBuilder },
            select()      { return updateBuilder },
            single()      { return updateBuilder },
            async then(resolve, reject) {
              try {
                const params = _filters
                const url    = `${base}/${table}?${params.join('&')}`
                const r      = await fetch(url, { method: 'PATCH', headers: svcH, body: JSON.stringify(payload) })
                const body   = await r.json()
                const data   = Array.isArray(body) ? body[0] : body
                const error  = r.ok ? null : { message: body?.message || body?.error || r.status }
                resolve({ data, error })
              } catch (e) { reject(e) }
            }
          }
          return updateBuilder
        },

        // DELETE
        delete() {
          const deleteBuilder = {
            eq(col, val) { _filters.push(`${col}=eq.${encodeURIComponent(val)}`); return deleteBuilder },
            async then(resolve, reject) {
              try {
                const url  = `${base}/${table}?${_filters.join('&')}`
                const r    = await fetch(url, { method: 'DELETE', headers: svcH })
                const error = r.ok ? null : { message: r.status }
                resolve({ data: null, error })
              } catch (e) { reject(e) }
            }
          }
          return deleteBuilder
        },
      }
      return builder
    }
  }
}

export async function authenticate(request) {
  const apiKey = (request.headers.get('X-API-Key') || request.headers.get('x-api-key') || '').trim()
  if (!apiKey) return err('Missing X-API-Key header', 401)

  const r = await fetch(
    `${SB_URL}/rest/v1/companies?select=id,name,api_key,invite_code&api_key=eq.${encodeURIComponent(apiKey)}&limit=1`,
    { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } }
  )
  if (!r.ok) return err('Invalid API key', 401)
  const rows    = await r.json()
  const company = rows?.[0]
  if (!company) return err('Invalid API key', 401)

  return { company, supabase: makeDb() }
}
