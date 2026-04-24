import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const SB_URL     = process.env.SUPABASE_URL
const SB_ANON   = process.env.SUPABASE_ANON_KEY
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

// Converte CNPJ somente dígitos para formato XX.XXX.XXX/XXXX-XX
function fmtCNPJ(v) {
  const d = (v || '').replace(/\D/g, '')
  if (d.length !== 14) return d
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  // ── Auth ─────────────────────────────────────────────────────────
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const sbAnon = createClient(SB_URL, SB_ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user } } = await sbAnon.auth.getUser()
  if (!user) return json({ error: 'Unauthorized' }, 401)

  const company_id = user.user_metadata?.company_id
  if (!company_id) return json({ error: 'company_id não encontrado' }, 400)

  // ── Payload ───────────────────────────────────────────────────────
  const { service_order_id } = await req.json()
  if (!service_order_id) return json({ error: 'service_order_id obrigatório' }, 400)

  const sbSvc = createClient(SB_URL, SB_SERVICE)

  // ── Busca a OS ────────────────────────────────────────────────────
  const { data: os, error: osErr } = await sbSvc
    .from('service_orders')
    .select('*, clients(name, email, cnpj, cpf)')
    .eq('id', service_order_id)
    .eq('company_id', company_id)
    .single()

  if (osErr || !os) return json({ error: 'OS não encontrada' }, 404)
  if (os.nfse_status === 'emitida') return json({ error: 'NFS-e já emitida para esta OS' }, 409)

  // ── Busca configurações NFS-e da empresa ─────────────────────────
  const { data: cfgRows } = await sbSvc
    .from('config')
    .select('key, value')
    .eq('company_id', company_id)
    .in('key', [
      'nfse_token',
      'nfse_ambiente',
      'nfse_cnpj',
      'nfse_razao_social',
      'nfse_inscricao_municipal',
      'nfse_codigo_municipio',
      'nfse_codigo_servico',
      'nfse_aliquota',
      'nfse_discriminacao',
    ])

  const cfg = {}
  ;(cfgRows || []).forEach(r => { cfg[r.key] = r.value })

  if (!cfg.nfse_token)  return json({ error: 'Token Focus NFe não configurado. Configure em Configurações → Fiscal.' }, 400)
  if (!cfg.nfse_cnpj)   return json({ error: 'CNPJ do emitente não configurado.' }, 400)

  const ambiente = cfg.nfse_ambiente || 'homologacao'
  const baseUrl  = 'https://api.focusnfe.com.br'

  // ── Monta referência única para idempotência ─────────────────────
  const referencia = `os_${service_order_id.replace(/-/g, '').slice(0, 20)}`

  // ── Marca OS como "emitindo" ─────────────────────────────────────
  await sbSvc.from('service_orders')
    .update({ nfse_status: 'emitindo', nfse_ref: referencia })
    .eq('id', service_order_id)

  // ── Monta payload Focus NFe ──────────────────────────────────────
  const valorServico = Number(os.total_value) || 0
  const aliquota     = Number(cfg.nfse_aliquota) || 0.05

  const body = {
    data_emissao:              new Date().toISOString(),
    prestador: {
      cnpj:                  (cfg.nfse_cnpj || '').replace(/\D/g, ''),
      inscricao_municipal:   cfg.nfse_inscricao_municipal || '',
      codigo_municipio:      cfg.nfse_codigo_municipio || '',
    },
    tomador: {
      // Se o cliente tiver CNPJ/CPF cadastrado, usa; senão emite sem tomador (NFS-e de balcão)
      ...(os.clients?.cnpj  ? { cnpj:  (os.clients.cnpj).replace(/\D/g, '') } : {}),
      ...(os.clients?.cpf   ? { cpf:   (os.clients.cpf).replace(/\D/g, '')  } : {}),
      ...(os.clients?.email ? { email: os.clients.email }                      : {}),
      razao_social: os.clients?.name || 'Consumidor Final',
    },
    servico: {
      valor_servicos:        valorServico.toFixed(2),
      item_lista_servico:    cfg.nfse_codigo_servico || '17.05',
      discriminacao:         cfg.nfse_discriminacao
        ? `${cfg.nfse_discriminacao} - OS: ${os.os_number}`
        : `${os.title} - OS: ${os.os_number}`,
      codigo_municipio:      cfg.nfse_codigo_municipio || '',
      aliquota:              aliquota.toFixed(4),
      issqn_retido:          false,
    },
  }

  // ── Envia para Focus NFe ─────────────────────────────────────────
  let focusRes, focusData
  try {
    focusRes = await fetch(
      `${baseUrl}/v2/nfse?ref=${referencia}&${ambiente === 'homologacao' ? 'homologacao=true' : ''}`,
      {
        method:  'POST',
        headers: {
          Authorization: 'Basic ' + btoa(cfg.nfse_token + ':'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    )
    focusData = await focusRes.json()
  } catch (err) {
    await sbSvc.from('service_orders')
      .update({ nfse_status: 'erro', nfse_error: err.message })
      .eq('id', service_order_id)
    return json({ error: 'Falha ao conectar Focus NFe: ' + err.message }, 502)
  }

  // ── Processa resposta ─────────────────────────────────────────────
  // Statuses possíveis Focus NFe: autorizado, processando_autorizacao, erro_autorizacao, cancelado
  const focusStatus = focusData.status || ''
  const nfseNumber  = focusData.numero           || focusData.numero_nfse     || null
  const nfseUrl     = focusData.caminho_xml_nota || focusData.caminho_danfse  || null
  const focusError  = (focusData.erros || []).map(e => e.mensagem).join('; ')

  if (focusStatus === 'autorizado') {
    await sbSvc.from('service_orders').update({
      nfse_status: 'emitida',
      nfse_number: nfseNumber,
      nfse_url:    nfseUrl,
      nfse_error:  null,
      status:      'faturada',
    }).eq('id', service_order_id)

    return json({ ok: true, nfse_number: nfseNumber, nfse_url: nfseUrl })
  }

  if (focusStatus === 'processando_autorizacao') {
    // Focus NFe processa em background — polling não implementado aqui
    // Mantenemos status 'emitindo'; um cron job pode checar depois
    return json({ ok: true, processing: true, message: 'NFS-e sendo processada pela prefeitura. Verifique em instantes.' })
  }

  // Erro
  await sbSvc.from('service_orders').update({
    nfse_status: 'erro',
    nfse_error:  focusError || JSON.stringify(focusData).slice(0, 500),
  }).eq('id', service_order_id)

  return json({ error: focusError || 'Erro desconhecido na emissão', raw: focusData }, 422)
}
