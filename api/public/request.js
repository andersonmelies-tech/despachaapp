/**
 * DespachaApp — API pública para solicitações de serviço
 * Chamado pelo formulário público /solicitar (sem autenticação)
 * Usa service_role key para bypass de RLS
 */
import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')   return json({ error: 'Method not allowed' }, 405)

  let body
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }

  const { name, phone, location, description, photos, invite_code } = body

  if (!name?.trim())        return json({ error: 'Nome obrigatório' }, 400)
  if (!description?.trim()) return json({ error: 'Descrição obrigatória' }, 400)
  if (!phone?.trim())       return json({ error: 'Telefone obrigatório' }, 400)

  const sb = createClient(
    process.env.SUPABASE_URL        || '',
    process.env.SUPABASE_SERVICE_KEY || ''
  )

  // Resolve company_id pelo invite_code ou pega a primeira empresa
  let company_id = null
  if (invite_code) {
    const { data: co } = await sb.from('companies').select('id')
      .eq('invite_code', invite_code).eq('active', true).maybeSingle()
    company_id = co?.id
  }
  if (!company_id) {
    const { data: co } = await sb.from('companies').select('id').limit(1).maybeSingle()
    company_id = co?.id
  }

  // Monta título resumido
  const title = description.trim().slice(0, 80)

  // Insere tarefa sem fotos primeiro (para ter o ID)
  const { data: task, error } = await sb.from('tasks').insert({
    title,
    description:      description.trim(),
    requester:        name.trim(),
    requester_phone:  phone.trim(),
    sector:           location?.trim() || null,
    status:           'pendente',
    urgency:          'media',
    source:           'publico',
    needs_approval:   true,
    provider_notified: false,
    company_id,
    assignee: 'A definir',
  }).select('id').single()

  if (error) {
    console.error('[public/request]', error)
    return json({ error: error.message }, 500)
  }

  // Faz upload das fotos para o Supabase Storage e guarda as URLs
  if (photos?.length) {
    try {
      const urls = await Promise.all(
        photos.slice(0, 3).map(async (base64, i) => {
          // base64 = "data:image/jpeg;base64,XXXX..."
          const match = base64.match(/^data:([^;]+);base64,(.+)$/)
          if (!match) return null
          const [, mime, data] = match
          const ext  = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
          const path = `${task.id}/${i}.${ext}`
          // Decodifica base64 → Uint8Array
          const binary = atob(data)
          const bytes  = new Uint8Array(binary.length)
          for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j)
          const { error: upErr } = await sb.storage
            .from('task-photos')
            .upload(path, bytes, { contentType: mime, upsert: true })
          if (upErr) { console.error('[upload]', upErr.message); return null }
          const { data: { publicUrl } } = sb.storage.from('task-photos').getPublicUrl(path)
          return publicUrl
        })
      )
      const validUrls = urls.filter(Boolean)
      if (validUrls.length) {
        await sb.from('tasks').update({ photos: JSON.stringify(validUrls) }).eq('id', task.id)
      }
    } catch (upErr) {
      console.error('[public/request] photo upload failed', upErr)
      // Continua mesmo sem fotos — não bloqueia a criação da tarefa
    }
  }

  return json({ ok: true, protocol: task.id })
}
