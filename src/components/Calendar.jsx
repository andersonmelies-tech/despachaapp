import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import TaskDetail, { URG_LABEL, STA_LABEL } from './TaskDetail.jsx'

const DAYS   = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

export default function Calendar({ showToast }) {
  const today = new Date()
  const [year,       setYear]       = useState(today.getFullYear())
  const [month,      setMonth]      = useState(today.getMonth())
  const [tasks,      setTasks]      = useState([])
  const [selected,   setSelected]   = useState(null)
  const [detailTask, setDetailTask] = useState(null)

  useEffect(() => {
    const start = new Date(year, month, 1).toISOString().split('T')[0]
    const end   = new Date(year, month + 1, 0).toISOString().split('T')[0]
    supabase.from('tasks').select('*').gte('due_date', start).lte('due_date', end)
      .then(r => setTasks(r.data || []))
  }, [year, month])

  function prev() { if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1) }
  function next() { if (month === 11) { setMonth(0); setYear(y => y + 1) } else setMonth(m => m + 1) }

  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrev  = new Date(year, month, 0).getDate()

  const cells = []
  for (let i = firstDay - 1; i >= 0; i--) cells.push({ day: daysInPrev - i, cur: false })
  for (let d = 1; d <= daysInMonth; d++)   cells.push({ day: d, cur: true })
  while (cells.length % 7 !== 0)           cells.push({ day: cells.length - firstDay - daysInMonth + 1, cur: false })

  function tasksByDay(d) {
    const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    return tasks.filter(t => t.due_date === dateStr)
  }

  async function reloadDay() {
    const start = new Date(year, month, 1).toISOString().split('T')[0]
    const end   = new Date(year, month + 1, 0).toISOString().split('T')[0]
    const { data } = await supabase.from('tasks').select('*').gte('due_date', start).lte('due_date', end)
    setTasks(data || [])
  }

  const selectedTasks = selected ? tasksByDay(selected) : []

  return (
    <div>
      <div className="cal-header">
        <div className="cal-month-label">{MONTHS[month]} {year}</div>
        <div className="cal-nav">
          <button className="cal-nav-btn" onClick={prev}>‹</button>
          <button className="cal-nav-btn" onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()) }}>Hoje</button>
          <button className="cal-nav-btn" onClick={next}>›</button>
        </div>
      </div>

      <div className="cal-grid">
        {DAYS.map(d => <div key={d} className="cal-dow">{d}</div>)}
      </div>
      <div className="cal-days">
        {cells.map((cell, i) => {
          const isToday = cell.cur && cell.day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
          const dayTasks = cell.cur ? tasksByDay(cell.day) : []
          return (
            <div
              key={i}
              className={`cal-cell${isToday ? ' today' : ''}${!cell.cur ? ' other-month' : ''}`}
              onClick={() => cell.cur && setSelected(selected === cell.day ? null : cell.day)}
            >
              <div className="cal-day-num">{cell.day}</div>
              {dayTasks.slice(0, 3).map(t => (
                <div
                  key={t.id}
                  className={`cal-task-chip ${t.status === 'concluida' ? 'concluida' : t.urgency}`}
                  onClick={e => { e.stopPropagation(); setDetailTask(t) }}
                  title={`#${t.id} — ${t.title}`}
                >
                  #{t.id} {t.title}
                </div>
              ))}
              {dayTasks.length > 3 && (
                <div style={{ fontSize: '.62rem', color: 'var(--muted)', marginTop: '.15rem' }}>
                  +{dayTasks.length - 3} mais
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Painel do dia selecionado */}
      {selected && (
        <div className="cfg-card" style={{ marginTop: '.85rem' }}>
          <div className="cfg-title">
            📅 {selected}/{month + 1}/{year} — {selectedTasks.length} tarefa(s)
            <button className="mclose" style={{ marginLeft: 'auto' }} onClick={() => setSelected(null)}>✕</button>
          </div>
          {selectedTasks.length === 0 ? (
            <div className="empty">Nenhuma tarefa neste dia</div>
          ) : selectedTasks.map(t => (
            <div
              key={t.id}
              className="cal-task-row"
              onClick={() => setDetailTask(t)}
              title="Clique para abrir detalhes"
            >
              <span className="cal-task-row-id">#{t.id}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{t.title}</div>
                <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: '.15rem' }}>
                  👤 {t.assignee} &nbsp;|&nbsp;
                  <span className={`ubadge ${t.urgency}`} style={{ padding: '.1rem .35rem' }}>{URG_LABEL[t.urgency]}</span>
                  &nbsp;|&nbsp;
                  <span className={`stbadge ${t.status}`} style={{ padding: '.1rem .35rem' }}>{STA_LABEL[t.status]}</span>
                </div>
              </div>
              <span className="cal-task-row-open">↗ Abrir</span>
            </div>
          ))}
        </div>
      )}

      {/* Modal de detalhe */}
      {detailTask && (
        <TaskDetail
          task={detailTask}
          onClose={() => setDetailTask(null)}
          onUpdate={reloadDay}
          showToast={showToast}
        />
      )}
    </div>
  )
}
