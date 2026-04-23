import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const BASE_URL = 'https://despachaapp.vercel.app/api/v1'

const ENDPOINTS = [
  {
    method: 'GET',
    path: '/tasks',
    desc: 'Lista tarefas da empresa. Aceita filtros: status, urgency, assignee_id, due_from, due_to, limit (máx 100), offset.',
    curl: `curl -X GET "${BASE_URL}/tasks?status=pendente&limit=20" \\
  -H "X-API-Key: SUA_API_KEY"`,
    response: `{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "Revisão elétrica",
      "assignee": "João Silva",
      "sector": "Manutenção",
      "urgency": "alta",
      "status": "pendente",
      "due_date": "2025-05-10T18:00:00Z",
      "created_at": "2025-04-23T10:00:00Z"
    }
  ],
  "total": 1
}`,
  },
  {
    method: 'POST',
    path: '/tasks',
    desc: 'Cria uma nova tarefa. Campos obrigatórios: title, requester, urgency. Opcionais: description, assignee_id, sector, due_date.',
    curl: `curl -X POST "${BASE_URL}/tasks" \\
  -H "X-API-Key: SUA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Revisão elétrica","requester":"Maria","urgency":"alta","sector":"Manutenção"}'`,
    response: `{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "Revisão elétrica",
    "status": "pendente",
    "created_at": "2025-04-23T10:00:00Z"
  }
}`,
  },
  {
    method: 'GET',
    path: '/task?id=UUID',
    desc: 'Retorna os dados completos de uma tarefa específica.',
    curl: `curl -X GET "${BASE_URL}/task?id=UUID" \\
  -H "X-API-Key: SUA_API_KEY"`,
    response: `{ "success": true, "data": { ...tarefa completa } }`,
  },
  {
    method: 'PATCH',
    path: '/task?id=UUID',
    desc: 'Atualiza uma tarefa. Campos permitidos: status, assignee_id, due_date, notes.',
    curl: `curl -X PATCH "${BASE_URL}/task?id=UUID" \\
  -H "X-API-Key: SUA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"em_andamento"}'`,
    response: `{ "success": true, "data": { ...tarefa atualizada } }`,
  },
  {
    method: 'GET',
    path: '/providers',
    desc: 'Lista os prestadores ativos da empresa.',
    curl: `curl -X GET "${BASE_URL}/providers" \\
  -H "X-API-Key: SUA_API_KEY"`,
    response: `{
  "success": true,
  "data": [
    { "id": "uuid", "name": "João Silva", "sector": "Elétrica", "active": 1 }
  ],
  "total": 1
}`,
  },
  {
    method: 'GET',
    path: '/stats',
    desc: 'Retorna estatísticas gerais da empresa: contagens por status, tarefas atrasadas, tempo médio e SLA.',
    curl: `curl -X GET "${BASE_URL}/stats" \\
  -H "X-API-Key: SUA_API_KEY"`,
    response: `{
  "success": true,
  "data": {
    "total": 45,
    "pendente": 12,
    "em_andamento": 8,
    "concluida": 22,
    "cancelada": 3,
    "atrasadas": 5,
    "avg_minutes": 187,
    "sla_compliance_pct": 82
  }
}`,
  },
  {
    method: 'POST',
    path: '/webhook',
    desc: 'Recebe eventos de ERP e cria tarefas automaticamente. Body: { event: "task.create", data: { title, requester, urgency, ... } }',
    curl: `curl -X POST "${BASE_URL}/webhook" \\
  -H "X-API-Key: SUA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"event":"task.create","data":{"title":"OS #1234","requester":"ERP","urgency":"media"}}'`,
    response: `{
  "success": true,
  "data": { "id": "uuid", "title": "OS #1234", "status": "pendente" }
}`,
  },
]

function MethodBadge({ method }) {
  return <span className={`method-badge ${method}`}>{method}</span>
}

export default function ApiDocs({ showToast }) {
  const [apiKey,      setApiKey]      = useState('')
  const [companyId,   setCompanyId]   = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [regen,       setRegen]       = useState(false)
  const [showKey,     setShowKey]     = useState(false)
  const [expanded,    setExpanded]    = useState(null)

  useEffect(() => {
    supabase.from('companies').select('id, api_key').limit(1).single()
      .then(({ data }) => {
        if (data) { setApiKey(data.api_key || ''); setCompanyId(data.id) }
        setLoading(false)
      })
  }, [])

  async function regenerate() {
    if (!confirm('Regenerar a chave de API? A chave atual deixará de funcionar imediatamente.')) return
    setRegen(true)
    const newKey = crypto.randomUUID().replace(/-/g, '')
    const { error } = await supabase.from('companies').update({ api_key: newKey }).eq('id', companyId)
    if (error) { showToast('Erro ao regenerar: ' + error.message, 'err') }
    else { setApiKey(newKey); showToast('Chave regenerada com sucesso ✓') }
    setRegen(false)
  }

  function copyKey() {
    if (!apiKey) return
    navigator.clipboard.writeText(apiKey)
    showToast('Chave copiada ✓')
  }

  function toggleExpand(i) {
    setExpanded(expanded === i ? null : i)
  }

  const displayKey = showKey ? apiKey : (apiKey ? apiKey.slice(0, 8) + '••••••••••••••••••••••' : '—')

  return (
    <div>
      {/* ── API Key ── */}
      <div className="cfg-card" style={{ marginBottom: '1rem' }}>
        <div className="cfg-title">🔑 Chave de API</div>
        <div style={{ fontSize: '.82rem', color: 'var(--muted)', marginBottom: '.85rem' }}>
          Use esta chave no header <code style={{ fontFamily: 'var(--mono)', background: 'var(--s3)', padding: '.1rem .35rem', borderRadius: '4px' }}>X-API-Key</code> em todas as requisições.
          Mantenha em segredo — ela dá acesso completo aos dados da sua empresa.
        </div>

        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: '.85rem' }}>Carregando…</div>
        ) : (
          <div className="api-key-box">
            <span className="api-key-val">{displayKey}</span>
            <button
              className="abtn"
              title={showKey ? 'Ocultar' : 'Mostrar'}
              onClick={() => setShowKey(v => !v)}
              style={{ flexShrink: 0 }}
            >
              {showKey ? '🙈' : '👁'}
            </button>
            <button className="btn-sec" onClick={copyKey} style={{ flexShrink: 0 }}>
              ⎘ Copiar
            </button>
            <button className="btn-danger" onClick={regenerate} disabled={regen} style={{ flexShrink: 0 }}>
              {regen ? '…' : '↻ Regenerar'}
            </button>
          </div>
        )}
      </div>

      {/* ── Base URL ── */}
      <div className="cfg-card" style={{ marginBottom: '1rem' }}>
        <div className="cfg-title">🌐 Base URL</div>
        <div className="api-key-box" style={{ marginBottom: 0 }}>
          <span className="api-key-val">{BASE_URL}</span>
          <button className="abtn" onClick={() => { navigator.clipboard.writeText(BASE_URL); showToast('URL copiada ✓') }}>⎘</button>
        </div>
      </div>

      {/* ── Endpoints ── */}
      <div className="cfg-card" style={{ marginBottom: '1rem' }}>
        <div className="cfg-title">📋 Endpoints disponíveis</div>
        <table className="endpoint-table">
          <thead>
            <tr>
              <th style={{ width: '70px' }}>Método</th>
              <th>Endpoint</th>
              <th>Descrição</th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map((ep, i) => (
              <>
                <tr
                  key={i}
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggleExpand(i)}
                >
                  <td><MethodBadge method={ep.method} /></td>
                  <td>
                    <code style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: 'var(--blue2)' }}>
                      {ep.path}
                    </code>
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: '.78rem' }}>
                    {ep.desc.split('.')[0]}.
                    <span style={{ color: 'var(--blue)', fontSize: '.72rem', marginLeft: '.4rem' }}>
                      {expanded === i ? '▲ menos' : '▼ exemplo'}
                    </span>
                  </td>
                </tr>
                {expanded === i && (
                  <tr key={`exp-${i}`}>
                    <td colSpan={3} style={{ padding: '0 .75rem .75rem' }}>
                      <div style={{ marginBottom: '.4rem', fontSize: '.72rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        cURL
                      </div>
                      <div className="curl-block">{ep.curl}</div>
                      <div style={{ marginTop: '.6rem', marginBottom: '.4rem', fontSize: '.72rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        Resposta de exemplo
                      </div>
                      <div className="curl-block">{ep.response}</div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Auth info ── */}
      <div className="cfg-card">
        <div className="cfg-title">🔒 Autenticação e CORS</div>
        <div style={{ fontSize: '.83rem', color: 'var(--muted)', lineHeight: 1.8 }}>
          Todos os endpoints exigem o header <code style={{ fontFamily: 'var(--mono)', background: 'var(--s3)', padding: '.1rem .35rem', borderRadius: '4px' }}>X-API-Key</code>.
          Requisições sem chave válida retornam <code style={{ fontFamily: 'var(--mono)', background: 'var(--s3)', padding: '.1rem .35rem', borderRadius: '4px' }}>401 Unauthorized</code>.<br /><br />
          CORS habilitado para todas as origens (<code style={{ fontFamily: 'var(--mono)', background: 'var(--s3)', padding: '.1rem .35rem', borderRadius: '4px' }}>*</code>).
          Métodos suportados: <strong>GET, POST, PATCH, OPTIONS</strong>.<br /><br />
          Formato de erro:
          <div className="curl-block" style={{ marginTop: '.5rem' }}>{'{ "success": false, "error": "Mensagem descritiva do erro" }'}</div>
        </div>
      </div>
    </div>
  )
}
