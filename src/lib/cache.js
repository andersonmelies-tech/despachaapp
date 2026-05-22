/**
 * Cache em memória para dados do Supabase.
 * Persiste enquanto a aba do browser estiver aberta.
 * Objetivo: troca de tela instantânea — mostra dados cached + refresh silencioso em background.
 */

const _store = new Map() // key → { data, ts }

/**
 * Lê dados do cache.
 * @param {string} key
 * @param {number} ttlMs — tempo em ms antes de considerar stale (padrão 5 min)
 * @returns {{ data: any, loaded: boolean }}
 */
export function cacheGet(key, ttlMs = 5 * 60 * 1000) {
  const entry = _store.get(key)
  if (!entry) return { data: null, loaded: false }
  return { data: entry.data, loaded: true }
}

/** Salva dados no cache. */
export function cacheSet(key, data) {
  _store.set(key, { data, ts: Date.now() })
}

/** Remove uma entrada (use após criar/editar/deletar para forçar refresh). */
export function cacheInvalidate(...keys) {
  keys.forEach(k => _store.delete(k))
}

/** Limpa tudo (ex: no logout). */
export function cacheClearAll() {
  _store.clear()
}
