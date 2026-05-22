import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, getCompanyId } from '../lib/supabase.js'

const _clc = { data: [], loaded: false }

// ── Estados brasileiros ───────────────────────────────────────────────────────
const ESTADOS = [
  { uf: 'AC', nome: 'Acre' },
  { uf: 'AL', nome: 'Alagoas' },
  { uf: 'AP', nome: 'Amapá' },
  { uf: 'AM', nome: 'Amazonas' },
  { uf: 'BA', nome: 'Bahia' },
  { uf: 'CE', nome: 'Ceará' },
  { uf: 'DF', nome: 'Distrito Federal' },
  { uf: 'ES', nome: 'Espírito Santo' },
  { uf: 'GO', nome: 'Goiás' },
  { uf: 'MA', nome: 'Maranhão' },
  { uf: 'MT', nome: 'Mato Grosso' },
  { uf: 'MS', nome: 'Mato Grosso do Sul' },
  { uf: 'MG', nome: 'Minas Gerais' },
  { uf: 'PA', nome: 'Pará' },
  { uf: 'PB', nome: 'Paraíba' },
  { uf: 'PR', nome: 'Paraná' },
  { uf: 'PE', nome: 'Pernambuco' },
  { uf: 'PI', nome: 'Piauí' },
  { uf: 'RJ', nome: 'Rio de Janeiro' },
  { uf: 'RN', nome: 'Rio Grande do Norte' },
  { uf: 'RS', nome: 'Rio Grande do Sul' },
  { uf: 'RO', nome: 'Rondônia' },
  { uf: 'RR', nome: 'Roraima' },
  { uf: 'SC', nome: 'Santa Catarina' },
  { uf: 'SP', nome: 'São Paulo' },
  { uf: 'SE', nome: 'Sergipe' },
  { uf: 'TO', nome: 'Tocantins' },
]

// ── Cache de municípios por UF ────────────────────────────────────────────────
const _citiesCache = {}

async function fetchCities(uf) {
  if (_citiesCache[uf]) return _citiesCache[uf]
  try {
    const res = await fetch(
      `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`
    )
    const data = await res.json()
    const cities = data.map(m => m.nome)
    _citiesCache[uf] = cities
    return cities
  } catch {
    return []
  }
}

// ── Formata endereço completo para exibição ───────────────────────────────────
function fmtAddr(c) {
  const parts = [
    c.street && c.number ? `${c.street}, ${c.number}` : (c.street || ''),
    c.complement,
    c.neighborhood,
    c.city && c.state ? `${c.city} - ${c.state}` : (c.city || c.state || ''),
    c.zip_code,
  ].filter(Boolean)
  return parts.join(' · ') || c.address || 'Sem endereço'
}

const EMPTY = {
  name: '', phone: '', email: '', notes: '',
  cnpj: '', cpf: '',
  street: '', number: '', complement: '', neighborhood: '',
  city: '', state: '', zip_code: '',
}

export default function Clients({ showToast }) {
  const [clients,  setClients]  = useState(_clc.data)
  const [modal,    setModal]    = useState(false)
  const [editing,  setEditing]  = useState(null)
  const [f,        setF]        = useState(EMPTY)
  const [saving,   setSaving]   = useState(false)
  const [search,   setSearch]   = useState('')
  const [cities,   setCities]   = useState([])
  const [loadingCities, setLoadingCities] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  async function load() {
    const { data } = await supabase.from('clients').select('*').eq('active', true).order('name')
    if (!mountedRef.current) return
    _clc.data   = data || []
    _clc.loaded = true
    setClients(_clc.data)
  }
  useEffect(() => { load() }, [])

  // Carrega cidades quando estado muda
  useEffect(() => {
    if (!f.state) { setCities([]); return }
    setLoadingCities(true)
    fetchCities(f.state).then(list => {
      setCities(list)
      setLoadingCities(false)
    })
  }, [f.state])

  function set(k, v) { setF(p => ({ ...p, [k]: v })) }

  function openNew() {
    setEditing(null)
    setF(EMPTY)
    setModal(true)
  }

  function openEdit(c) {
    setEditing(c)
    setF({
      name:         c.name || '',
      phone:        c.phone || '',
      email:        c.email || '',
      notes:        c.notes || '',
      cnpj:         c.cnpj || '',
      cpf:          c.cpf || '',
      street:       c.street || '',
      number:       c.number || '',
      complement:   c.complement || '',
      neighborhood: c.neighborhood || '',
      city:         c.city || '',
      state:        c.state || '',
      zip_code:     c.zip_code || '',
    })
    setModal(true)
  }

  async function save() {
    if (!f.name.trim()) return showToast('Nome obrigatório', 'err')
    setSaving(true)

    const payload = {
      name:         f.name.trim(),
      phone:        f.phone || null,
      email:        f.email || null,
      notes:        f.notes || null,
      cnpj:         f.cnpj.replace(/\D/g, '') || null,
      cpf:          f.cpf.replace(/\D/g, '') || null,
      street:       f.street || null,
      number:       f.number || null,
      complement:   f.complement || null,
      neighborhood: f.neighborhood || null,
      city:         f.city || null,
      state:        f.state || null,
      zip_code:     f.zip_code.replace(/\D/g, '') || null,
      // Mantém campo legado para compatibilidade com telas antigas
      address: [f.street, f.number, f.neighborhood, f.city, f.state].filter(Boolean).join(', ') || null,
    }

    if (editing) {
      const { error } = await supabase.from('clients').update(payload).eq('id', editing.id)
      if (error) { showToast('Erro: ' + error.message, 'err'); setSaving(false); return }
    } else {
      payload.company_id = await getCompanyId()
      const { error } = await supabase.from('clients').insert(payload)
      if (error) { showToast('Erro: ' + error.message, 'err'); setSaving(false); return }
    }

    showToast(editing ? 'Cliente atualizado ✓' : 'Cliente criado ✓')
    setSaving(false)
    setModal(false)
    load()
  }

  async function del(id) {
    if (!confirm('Arquivar este cliente?')) return
    await supabase.from('clients').update({ active: false }).eq('id', id)
    showToast('Cliente arquivado')
    load()
  }

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.cnpj || '').includes(search.replace(/\D/g,''))
  )

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '.75rem', flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: 'var(--mono)', fontSize: '1rem', color: 'var(--blue)', letterSpacing: '.04em' }}>👥 CLIENTES</h2>
        <div style={{ display: 'flex', gap: '.65rem', flex: 1, maxWidth: 440 }}>
          <input className="finput" placeholder="Buscar cliente..." value={search}
            onChange={e => setSearch(e.target.value)} style={{ flex: 1 }} />
          <button className="btn-primary" onClick={openNew}>+ Novo Cliente</button>
        </div>
      </div>

      {/* Lista */}
      <div className="cfg-card">
        {filtered.length === 0 ? (
          <div className="empty">Nenhum cliente cadastrado</div>
        ) : filtered.map(c => (
          <div key={c.id} className="provider-row">
            <div className="provider-avatar"
              style={{ background: 'linear-gradient(135deg, var(--blue), var(--purple))', fontWeight: 700, fontSize: '1.1rem' }}>
              {c.name.charAt(0).toUpperCase()}
            </div>
            <div className="provider-info" style={{ flex: 1 }}>
              <div className="provider-name">
                {c.name}
                {c.cnpj && (
                  <span style={{ marginLeft: '.5rem', fontSize: '.7rem', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                    CNPJ {c.cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')}
                  </span>
                )}
              </div>
              <div className="provider-meta">
                {[c.phone, c.email].filter(Boolean).join(' · ')}{c.phone || c.email ? ' · ' : ''}
                {c.city && c.state ? `${c.city} - ${c.state}` : (c.address || 'Sem endereço')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '.35rem' }}>
              <button className="abtn" onClick={() => openEdit(c)}>✏</button>
              <button className="abtn r" onClick={() => del(c.id)}>🗑</button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {modal && (
        <div className="overlay open" onClick={e => e.target.className === 'overlay open' && setModal(false)}>
          <div className="modal" style={{ maxWidth: 660 }}>
            <div className="mhead">
              <span className="mtitle">{editing ? 'EDITAR CLIENTE' : 'NOVO CLIENTE'}</span>
              <button className="mclose" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="mbody">
              <div className="fgrid">

                {/* ── Dados básicos ── */}
                <div className="fg full">
                  <label className="flabel">NOME / RAZÃO SOCIAL *</label>
                  <input className="finput" value={f.name}
                    onChange={e => set('name', e.target.value)}
                    placeholder="Nome completo ou razão social" autoFocus />
                </div>
                <div className="fg">
                  <label className="flabel">TELEFONE</label>
                  <input className="finput" value={f.phone}
                    onChange={e => set('phone', e.target.value)}
                    placeholder="(47) 99999-9999" />
                </div>
                <div className="fg">
                  <label className="flabel">E-MAIL</label>
                  <input className="finput" type="email" value={f.email}
                    onChange={e => set('email', e.target.value)}
                    placeholder="email@empresa.com.br" />
                </div>
                <div className="fg">
                  <label className="flabel">CNPJ</label>
                  <input className="finput" value={f.cnpj}
                    onChange={e => set('cnpj', e.target.value)}
                    placeholder="00.000.000/0001-00"
                    maxLength={18} />
                </div>
                <div className="fg">
                  <label className="flabel">CPF (pessoa física)</label>
                  <input className="finput" value={f.cpf}
                    onChange={e => set('cpf', e.target.value)}
                    placeholder="000.000.000-00"
                    maxLength={14} />
                </div>

                {/* ── Separador endereço ── */}
                <div className="fg full">
                  <div style={{ borderTop: '1px solid var(--border)', margin: '.25rem 0 .5rem', opacity: .4 }} />
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)', letterSpacing: '.08em', fontFamily: 'var(--mono)' }}>
                    📍 ENDEREÇO
                  </div>
                </div>

                {/* Logradouro */}
                <div className="fg" style={{ flex: 2 }}>
                  <label className="flabel">LOGRADOURO (Rua / Av / Rod)</label>
                  <input className="finput" value={f.street}
                    onChange={e => set('street', e.target.value)}
                    placeholder="Ex: Av. Adolfo Konder" />
                </div>
                <div className="fg" style={{ flex: '0 0 110px', minWidth: 90 }}>
                  <label className="flabel">NÚMERO</label>
                  <input className="finput" value={f.number}
                    onChange={e => set('number', e.target.value)}
                    placeholder="2600" />
                </div>

                {/* Complemento e Bairro */}
                <div className="fg">
                  <label className="flabel">COMPLEMENTO</label>
                  <input className="finput" value={f.complement}
                    onChange={e => set('complement', e.target.value)}
                    placeholder="Sala 3, Galpão B..." />
                </div>
                <div className="fg">
                  <label className="flabel">BAIRRO</label>
                  <input className="finput" value={f.neighborhood}
                    onChange={e => set('neighborhood', e.target.value)}
                    placeholder="Nome do bairro" />
                </div>

                {/* CEP */}
                <div className="fg" style={{ flex: '0 0 140px', minWidth: 120 }}>
                  <label className="flabel">CEP</label>
                  <input className="finput" value={f.zip_code}
                    onChange={e => set('zip_code', e.target.value)}
                    placeholder="88301-900"
                    maxLength={9} />
                </div>

                {/* Estado */}
                <div className="fg" style={{ flex: '0 0 200px', minWidth: 160 }}>
                  <label className="flabel">ESTADO</label>
                  <select className="finput" value={f.state}
                    onChange={e => { set('state', e.target.value); set('city', '') }}>
                    <option value="">Selecione o estado…</option>
                    {ESTADOS.map(e => (
                      <option key={e.uf} value={e.uf}>{e.uf} — {e.nome}</option>
                    ))}
                  </select>
                </div>

                {/* Cidade */}
                <div className="fg">
                  <label className="flabel">
                    CIDADE
                    {loadingCities && <span style={{ marginLeft: '.4rem', color: 'var(--muted)', fontSize: '.68rem' }}>carregando…</span>}
                  </label>
                  {cities.length > 0 ? (
                    <select className="finput" value={f.city}
                      onChange={e => set('city', e.target.value)}>
                      <option value="">Selecione a cidade…</option>
                      {cities.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  ) : (
                    <input className="finput" value={f.city}
                      onChange={e => set('city', e.target.value)}
                      placeholder={f.state ? 'Selecione o estado primeiro' : 'Nome da cidade'}
                      disabled={!!f.state && loadingCities} />
                  )}
                </div>

                {/* Observações */}
                <div className="fg full">
                  <label className="flabel">OBSERVAÇÕES INTERNAS</label>
                  <textarea className="finput" rows={2} value={f.notes}
                    onChange={e => set('notes', e.target.value)}
                    placeholder="Notas sobre o cliente, condições especiais..."
                    style={{ resize: 'vertical' }} />
                </div>

              </div>
            </div>
            <div className="mfoot">
              <button className="btn-sec" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Salvando…' : '✓ Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
