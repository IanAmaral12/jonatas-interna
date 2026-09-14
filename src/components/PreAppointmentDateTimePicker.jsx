import { useRef, useState } from 'react'
import { CalendarDays, Check, ChevronDown, Clock3 } from 'lucide-react'
import { DayPicker } from '@daypicker/react'
import { ptBR } from '@daypicker/react/locale'
import { preAppointmentInputValue, preAppointmentTimestamp } from '../lib/preAppointments'

const formatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})
const pad = (value) => String(value).padStart(2, '0')
const dateValue = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export default function PreAppointmentDateTimePicker({ value, onChange, disabled = false }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const [date, time = '00:00'] = value.split('T')
  const [hour = '00', minute = '00'] = time.split(':')
  const selected = date ? new Date(`${date}T12:00:00`) : undefined
  const timestamp = preAppointmentTimestamp(value)
  const updateTime = (nextHour, nextMinute) => onChange(`${date}T${nextHour}:${nextMinute}`)
  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div
      className={`pre-datetime-picker${open ? ' open' : ''}`}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.stopPropagation()
          close()
        }
      }}
    >
      <label id="pre-datetime-label" htmlFor="pre-date">
        Data e hora
      </label>
      <button
        ref={triggerRef}
        id="pre-date"
        className="pre-datetime-trigger"
        type="button"
        disabled={disabled}
        aria-labelledby="pre-datetime-label pre-datetime-value"
        aria-expanded={open}
        aria-controls="pre-datetime-calendar"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="pre-datetime-icon">
          <CalendarDays size={18} />
        </span>
        <span id="pre-datetime-value">
          {timestamp ? formatter.format(new Date(timestamp)) : 'Selecione data e hora'}
        </span>
        <ChevronDown className="pre-datetime-chevron" size={17} />
      </button>
      {open && (
        <div
          className="pre-datetime-panel"
          id="pre-datetime-calendar"
          role="group"
          aria-label="Selecionar data e hora"
        >
          <DayPicker
            mode="single"
            required
            locale={ptBR}
            selected={selected}
            defaultMonth={selected}
            onSelect={(nextDate) => {
              if (nextDate) onChange(`${dateValue(nextDate)}T${hour}:${minute}`)
            }}
            showOutsideDays
            fixedWeeks
            weekStartsOn={0}
          />
          <div className="pre-datetime-time">
            <span>
              <Clock3 size={17} /> Horário
            </span>
            <div className="pre-datetime-time-fields">
              <select
                aria-label="Hora"
                value={hour}
                disabled={disabled}
                onChange={(event) => updateTime(event.target.value, minute)}
              >
                {Array.from({ length: 24 }, (_, index) => (
                  <option key={index} value={pad(index)}>
                    {pad(index)}
                  </option>
                ))}
              </select>
              <b aria-hidden="true">:</b>
              <select
                aria-label="Minuto"
                value={minute}
                disabled={disabled}
                onChange={(event) => updateTime(hour, event.target.value)}
              >
                {Array.from({ length: 60 }, (_, index) => (
                  <option key={index} value={pad(index)}>
                    {pad(index)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="pre-datetime-footer">
            <button
              type="button"
              className="pre-datetime-now"
              onClick={() => {
                onChange(preAppointmentInputValue(new Date()))
                close()
              }}
            >
              Agora
            </button>
            <button type="button" className="pre-datetime-done" onClick={close}>
              <Check size={16} /> Concluir
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
