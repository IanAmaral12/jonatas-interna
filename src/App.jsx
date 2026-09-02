import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleDollarSign,
  Eye,
  EyeOff,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  Moon,
  Plus,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  Trash2,
  TrendingDown,
  Users,
  WalletCards,
} from 'lucide-react'
import { DayPicker } from '@daypicker/react'
import { ptBR } from '@daypicker/react/locale'
import '@daypicker/react/style.css'
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { supabase, supabaseConfigError } from './lib/supabase'
import './App.css'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const initialForm = { email: '', password: '', confirmPassword: '' }

const errorMessages = {
  'Invalid login credentials': 'E-mail ou senha incorretos.',
  'Email not confirmed': 'Confirme seu e-mail antes de entrar.',
  'Password should be at least 6 characters': 'A senha deve ter pelo menos 6 caracteres.',
  'Unable to validate email address: invalid format': 'Digite um endereço de e-mail válido.',
}

function friendlyError(message) {
  return errorMessages[message] || message || 'Não foi possível concluir. Tente novamente.'
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
    </span>
  )
}

function PasswordField({ id, label, value, onChange, autoComplete, placeholder = 'Sua senha' }) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="field-group">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <LockKeyhole size={18} aria-hidden="true" />
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          minLength={6}
          required
        />
        <button
          className="visibility-button"
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  )
}

function localDateValue(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateFromValue(value) {
  if (!value) return undefined
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

function moveDate(date, days) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function getDatePresets(reference = new Date()) {
  const today = dateFromValue(localDateValue(reference))
  const yesterday = moveDate(today, -1)
  const weekStart = moveDate(today, -today.getDay())
  const weekEnd = moveDate(weekStart, 6)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1, 12)
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 12)
  const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1, 12)
  const previousMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0, 12)

  return [
    { id: 'today', label: 'Hoje', start: today, end: today },
    { id: 'yesterday', label: 'Ontem', start: yesterday, end: yesterday },
    { id: 'this-week', label: 'Esta semana', detail: 'Domingo a sábado', start: weekStart, end: weekEnd },
    { id: 'this-month', label: 'Este mês', start: monthStart, end: monthEnd },
    { id: 'last-month', label: 'Mês passado', start: previousMonthStart, end: previousMonthEnd },
  ]
}

const shortDateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

function periodLabel(filters) {
  const start = dateFromValue(filters.start)
  const end = dateFromValue(filters.end)
  if (!start) return 'Selecione um período'
  if (!end) return `${shortDateFormatter.format(start)} — selecione o fim`
  if (filters.start === filters.end) return shortDateFormatter.format(start)
  return `${shortDateFormatter.format(start)} — ${shortDateFormatter.format(end)}`
}

function selectedDays(filters) {
  const start = dateFromValue(filters.start)
  const end = dateFromValue(filters.end)
  if (!start || !end) return 0
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
  return Math.round((endUtc - startUtc) / 86400000) + 1
}

function DateRangeFilter({ filters, appliedFilters, setFilters, onApply, loading }) {
  const containerRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => dateFromValue(filters.start))
  const [compact, setCompact] = useState(() => window.innerWidth <= 1050)
  const presets = getDatePresets()
  const range = filters.start ? {
    from: dateFromValue(filters.start),
    to: dateFromValue(filters.end),
  } : undefined
  const totalDays = selectedDays(filters)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1050px)')
    const updateLayout = (event) => setCompact(event.matches)
    media.addEventListener('change', updateLayout)
    return () => media.removeEventListener('change', updateLayout)
  }, [])

  useEffect(() => {
    if (!open) return undefined

    const closeOnOutsideClick = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setFilters({ ...appliedFilters })
        setOpen(false)
      }
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setFilters({ ...appliedFilters })
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [appliedFilters, open, setFilters])

  const toggleCalendar = () => {
    if (open) {
      setFilters({ ...appliedFilters })
      setOpen(false)
    } else {
      setMonth(dateFromValue(appliedFilters.start) || new Date())
      setOpen(true)
    }
  }

  const selectRange = (nextRange) => {
    if (!nextRange?.from) return
    setFilters({
      start: localDateValue(nextRange.from),
      end: nextRange.to ? localDateValue(nextRange.to) : '',
    })
  }

  const selectPreset = (preset) => {
    setFilters({ start: localDateValue(preset.start), end: localDateValue(preset.end) })
    setMonth(preset.start)
  }

  const cancelSelection = () => {
    setFilters({ ...appliedFilters })
    setOpen(false)
  }

  const applySelection = (event) => {
    event.preventDefault()
    if (!filters.start || !filters.end) return
    onApply()
    setOpen(false)
  }

  return (
    <div className="date-filter" ref={containerRef}>
      <button
        className={`period-trigger${open ? ' open' : ''}`}
        type="button"
        onClick={toggleCalendar}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="period-trigger-icon"><CalendarDays size={19} /></span>
        <span className="period-trigger-copy">
          <small>Período</small>
          <strong>{periodLabel(filters)}</strong>
        </span>
        <ChevronDown className="period-trigger-chevron" size={17} />
      </button>

      {open && (
        <form className="date-popover" onSubmit={applySelection} role="dialog" aria-label="Selecionar período">
          <div className="date-popover-heading">
            <div>
              <span>Filtrar por período</span>
              <strong>{filters.end ? `${totalDays} ${totalDays === 1 ? 'dia selecionado' : 'dias selecionados'}` : 'Agora escolha a data final'}</strong>
            </div>
            <span className="selection-dot" aria-hidden="true" />
          </div>

          <div className="date-popover-body">
            <div className="date-presets" role="group" aria-label="Períodos rápidos">
              <span className="date-presets-label">Atalhos</span>
              {presets.map((preset) => {
                const active = filters.start === localDateValue(preset.start)
                  && filters.end === localDateValue(preset.end)
                return (
                  <button
                    className={`date-preset${active ? ' active' : ''}`}
                    type="button"
                    key={preset.id}
                    onClick={() => selectPreset(preset)}
                  >
                    <span><strong>{preset.label}</strong>{preset.detail && <small>{preset.detail}</small>}</span>
                    {active && <Check size={15} />}
                  </button>
                )
              })}
            </div>

            <DayPicker
              animate
              fixedWeeks
              locale={ptBR}
              mode="range"
              month={month}
              navLayout="around"
              numberOfMonths={compact ? 1 : 2}
              onMonthChange={setMonth}
              onSelect={selectRange}
              resetOnSelect
              selected={range}
              showOutsideDays
              weekStartsOn={0}
            />
          </div>

          <div className="date-popover-footer">
            <span><CalendarDays size={15} />{periodLabel(filters)}</span>
            <div>
              <button className="date-cancel" type="button" onClick={cancelSelection}>Cancelar</button>
              <button className="date-apply" type="submit" disabled={loading || !filters.start || !filters.end}>
                {loading ? <LoaderCircle className="spin" size={17} /> : 'Filtrar'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}

function money(value, currency) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}

function decimal(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits }).format(Number(value || 0))
}

function rate(value, suffix = '%') {
  return value === null || value === undefined ? '—' : `${decimal(value)}${suffix}`
}

function Dashboard({ theme }) {
  const today = localDateValue()
  const [filters, setFilters] = useState({ start: today, end: today })
  const [appliedFilters, setAppliedFilters] = useState({ start: today, end: today })
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const currency = 'BRL'

  useEffect(() => {
    let active = true

    const loadMetrics = async () => {
      setLoading(true)
      setError('')
      const { data, error: queryError } = await supabase.rpc('get_cpa_dashboard', {
        p_start_date: appliedFilters.start,
        p_end_date: appliedFilters.end,
      })

      if (!active) return
      if (queryError) {
        setError('Não foi possível carregar os dados do dashboard.')
        setRows([])
      } else {
        setRows((data || []).map((row) => ({
          ...row,
          spend: Number(row.spend || 0),
          leads: Number(row.leads || 0),
          appointments: Number(row.appointments || 0),
          revenue: Number(row.revenue || 0),
          cpa: row.cpa === null ? null : Number(row.cpa),
          cpl: Number(row.leads || 0) > 0
            ? Number(row.spend || 0) / Number(row.leads)
            : null,
          conversion_rate: row.conversion_rate === null ? null : Number(row.conversion_rate),
          lead_to_appointment_ratio: row.lead_to_appointment_ratio === null ? null : Number(row.lead_to_appointment_ratio),
          roas: row.roas === null ? null : Number(row.roas),
          average_ticket: row.average_ticket === null ? null : Number(row.average_ticket),
        })))
      }
      setLoading(false)
    }

    loadMetrics()
    return () => { active = false }
  }, [appliedFilters])

  const currencyRows = rows.filter((row) => row.currency === currency)
  const general = rows.find((row) => row.currency === currency && row.row_type === 'general')
  const summary = {
    spend: general?.spend || 0,
    leads: general?.leads || 0,
    appointments: general?.appointments || 0,
    revenue: general?.revenue || 0,
    cpa: general?.cpa ?? null,
    cpl: general?.cpl ?? null,
    conversionRate: general?.conversion_rate ?? null,
    roas: general?.roas ?? null,
    averageTicket: general?.average_ticket ?? null,
  }
  const cpaRanking = currencyRows
    .filter((row) => row.seller_id && !row.currency_conflict)
    .sort((first, second) => {
      if (first.cpa === null) return 1
      if (second.cpa === null) return -1
      return first.cpa - second.cpa
    })
    .filter((row) => row.cpa !== null)
  const appointmentRanking = currencyRows
    .filter((row) => row.seller_id && row.appointments > 0)
    .sort((first, second) => second.appointments - first.appointments
      || first.seller_name.localeCompare(second.seller_name, 'pt-BR'))
  const commercialRows = currencyRows
    .filter((row) => row.seller_id)
    .sort((first, second) => second.appointments - first.appointments
      || second.revenue - first.revenue
      || first.seller_name.localeCompare(second.seller_name, 'pt-BR'))
  const unmappedSpend = currencyRows
    .filter((row) => row.row_type === 'unmatched')
    .reduce((total, row) => total + row.spend, 0)

  const appointmentChartData = {
    labels: appointmentRanking.map((row) => row.seller_name.split(' ')[0]),
    datasets: [{
      label: 'Agendamentos',
      data: appointmentRanking.map((row) => row.appointments),
      backgroundColor: appointmentRanking.map((_, index) =>
        index === 0 ? '#ff7a1a' : `rgba(255, 122, 26, ${Math.max(.3, .76 - index * .08)})`
      ),
      borderColor: '#ff7a1a',
      borderWidth: 1,
      borderRadius: 9,
      borderSkipped: false,
      maxBarThickness: 52,
    }],
  }
  const appointmentChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => ` ${context.raw} ${context.raw === 1 ? 'agendamento' : 'agendamentos'}`,
          afterLabel: (context) => {
            const row = appointmentRanking[context.dataIndex]
            return row.cpa === null ? '' : `CPA: ${money(row.cpa, currency)}`
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: theme === 'dark' ? '#fbfaf8' : '#181411', font: { size: 12, weight: 650 } },
      },
      y: {
        beginAtZero: true,
        grid: { color: theme === 'dark' ? 'rgba(255,255,255,.07)' : 'rgba(24,20,17,.08)' },
        ticks: {
          color: theme === 'dark' ? '#aaa19a' : '#746c66',
          precision: 0,
          stepSize: 1,
          font: { size: 11, weight: 600 },
        },
      },
    },
  }

  const applyFilters = () => {
    if (filters.start <= filters.end) setAppliedFilters({ ...filters })
  }

  return (
    <section id="dashboard" className="dashboard-content" aria-label="Dashboard de performance">
      <header className="dashboard-header">
        <div>
          <span className="dashboard-eyebrow">Visão de performance</span>
          <h1>Dashboard de performance</h1>
          <p>Mídia e agendamentos da operação em uma única visão.</p>
        </div>
        <DateRangeFilter
          filters={filters}
          appliedFilters={appliedFilters}
          setFilters={setFilters}
          onApply={applyFilters}
          loading={loading}
        />
      </header>

      {error && <div className="dashboard-alert error"><AlertTriangle size={18} />{error}</div>}

      <div className="metric-grid">
        <article className="metric-card">
          <div className="metric-icon"><TrendingDown size={20} /></div>
          <div className="metric-label"><span>CPA geral</span><b>BRL</b></div>
          <strong>{summary.cpa === null ? '—' : money(summary.cpa, currency)}</strong>
          <small>{summary.appointments} agendamentos</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon"><CircleDollarSign size={20} /></div>
          <div className="metric-label"><span>Investimento</span><b>{currency}</b></div>
          <strong>{money(summary.spend, currency)}</strong>
          <small>No período selecionado</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon"><Target size={20} /></div>
          <div className="metric-label"><span>CPL geral</span><b>BRL</b></div>
          <strong>{summary.cpl === null ? '—' : money(summary.cpl, currency)}</strong>
          <small>{summary.leads} conversas iniciadas</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon"><Users size={20} /></div>
          <div className="metric-label"><span>Agendamentos</span><b>Pedidos</b></div>
          <strong>{summary.appointments}</strong>
          <small>Todos os pedidos não cancelados</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon"><Target size={20} /></div>
          <div className="metric-label"><span>Conversão</span><b>Conversas</b></div>
          <strong>{rate(summary.conversionRate)}</strong>
          <small>{summary.leads} conversas · {summary.appointments} agendamentos</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon"><CircleDollarSign size={20} /></div>
          <div className="metric-label"><span>Faturamento</span><b>BRL</b></div>
          <strong>{money(summary.revenue, currency)}</strong>
          <small>Pedidos não cancelados criados no período</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon"><ChartNoAxesCombined size={20} /></div>
          <div className="metric-label"><span>ROAS</span><b>Retorno</b></div>
          <strong>{rate(summary.roas, 'x')}</strong>
          <small>{summary.roas === null ? 'Sem investimento no período' : `Cada R$ 1 gerou R$ ${decimal(summary.roas)}`}</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon"><ReceiptText size={20} /></div>
          <div className="metric-label"><span>Ticket médio</span><b>BRL</b></div>
          <strong>{summary.averageTicket === null ? '—' : money(summary.averageTicket, currency)}</strong>
          <small>{summary.appointments} {summary.appointments === 1 ? 'agendamento' : 'agendamentos'}</small>
        </article>
      </div>

      {unmappedSpend > 0 && (
        <div className="dashboard-alert"><AlertTriangle size={18} />
          {money(unmappedSpend, currency)} ainda sem vendedor.
        </div>
      )}

      <div className="analytics-grid">
        <article className="performance-panel cpa-ranking-panel">
          <div className="ranking-header">
            <div><span>Eficiência por vendedor</span><h2>Ranking de menor CPA</h2></div>
            <span className="currency-reference">BRL</span>
          </div>
          <div className="cpa-ranking-list">
            {loading ? <div className="dashboard-empty"><LoaderCircle className="spin" size={24} />Atualizando métricas...</div>
              : cpaRanking.length > 0 ? cpaRanking.map((row, index) => (
                <div className={`cpa-rank-card${index === 0 ? ' winner' : ''}`} key={row.seller_id}>
                  <span className="rank-position">{index + 1}</span>
                  <div className="rank-seller">
                    <strong>{row.seller_name}</strong>
                    <small>{row.appointments} {row.appointments === 1 ? 'agendamento' : 'agendamentos'} · {money(row.spend, currency)} investidos</small>
                  </div>
                  <div className="rank-cpa"><small>CPA</small><strong>{money(row.cpa, currency)}</strong></div>
                </div>
              )) : <div className="dashboard-empty"><TrendingDown size={28} /><strong>Sem CPA no período</strong><span>O ranking aparecerá quando houver investimento e agendamentos.</span></div>}
          </div>
        </article>

        <article className="performance-panel appointment-panel">
          <div className="ranking-header">
            <div><span>Volume por vendedor</span><h2>Ranking de agendamentos</h2></div>
            <span className="currency-reference">Não cancelados</span>
          </div>
          <div className="appointment-chart-area">
            {loading ? <div className="dashboard-empty"><LoaderCircle className="spin" size={24} />Atualizando métricas...</div>
              : appointmentRanking.length > 0 ? <Bar data={appointmentChartData} options={appointmentChartOptions} />
                : <div className="dashboard-empty"><Users size={28} /><strong>Sem agendamentos no período</strong><span>O gráfico será preenchido quando houver pedidos não cancelados.</span></div>}
          </div>
        </article>
      </div>

      <article className="seller-performance-panel">
        <div className="ranking-header">
          <div><span>Funil e retorno</span><h2>Performance comercial por vendedor</h2></div>
          <span className="currency-reference">Lead = conversa iniciada</span>
        </div>
        <div className="seller-performance-scroll">
          <div className="seller-performance-table">
            <div className="seller-performance-row seller-performance-head">
              <span>Vendedor</span><span>Investimento</span><span>CPL</span><span>Conversas iniciadas</span><span>Agendamentos</span><span>Conversão</span><span>Faturamento</span><span>ROAS</span><span>Ticket médio</span>
            </div>
            {loading ? <div className="seller-performance-loading"><LoaderCircle className="spin" size={22} />Atualizando indicadores...</div>
              : commercialRows.length > 0 ? commercialRows.map((row, index) => (
                <div className="seller-performance-row" key={row.seller_id}>
                  <div className="seller-cell"><span>{index + 1}</span><strong>{row.seller_name}</strong></div>
                  <div className="commercial-cell"><small>Investimento</small><strong>{money(row.spend, currency)}</strong></div>
                  <div className="commercial-cell"><small>CPL</small><strong>{row.cpl === null ? '—' : money(row.cpl, currency)}</strong></div>
                  <div className="commercial-cell"><small>Conversas iniciadas</small><strong>{row.leads}</strong></div>
                  <div className="commercial-cell"><small>Agendamentos</small><strong>{row.appointments}</strong></div>
                  <div className="commercial-cell"><small>Conversão</small><strong>{rate(row.conversion_rate)}</strong></div>
                  <div className="commercial-cell"><small>Faturamento</small><strong>{money(row.revenue, currency)}</strong></div>
                  <div className="commercial-cell"><small>ROAS</small><strong>{rate(row.roas, 'x')}</strong></div>
                  <div className="commercial-cell"><small>Ticket médio</small><strong>{row.average_ticket === null ? '—' : money(row.average_ticket, currency)}</strong></div>
                </div>
              )) : <div className="seller-performance-loading"><Users size={23} />Sem dados por vendedor no período.</div>}
          </div>
        </div>
      </article>
    </section>
  )
}

const emptyCashEntry = {
  author: '',
  amount: '',
  description: '',
  entryType: 'entrada',
}

function cashFlowDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function parseCashAmount(value) {
  const normalized = value.trim().replace(/\s/g, '')
  return Number(normalized.includes(',')
    ? normalized.replace(/\./g, '').replace(',', '.')
    : normalized)
}

function CashFlowPage() {
  const [entries, setEntries] = useState([])
  const [form, setForm] = useState(emptyCashEntry)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    let active = true

    const loadEntries = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('cash_flow_entries')
        .select('id,author,amount,description,entry_type,created_at')
        .order('created_at', { ascending: false })

      if (!active) return
      if (error) {
        setMessage({ type: 'error', text: 'Não foi possível carregar o fluxo de caixa.' })
        setEntries([])
      } else {
        setEntries((data || []).map((entry) => ({
          ...entry,
          amount: Number(entry.amount),
        })))
      }
      setLoading(false)
    }

    loadEntries()
    return () => { active = false }
  }, [])

  const totals = entries.reduce((result, entry) => {
    if (entry.entry_type === 'entrada') result.income += entry.amount
    if (entry.entry_type === 'saida') result.expenses += entry.amount
    return result
  }, { income: 0, expenses: 0 })
  const balance = totals.income - totals.expenses

  const updateCashField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
    if (message) setMessage(null)
  }

  const saveEntry = async (event) => {
    event.preventDefault()
    const amount = parseCashAmount(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage({ type: 'error', text: 'Informe um valor maior que zero.' })
      return
    }

    setSaving(true)
    setMessage(null)
    const { data, error } = await supabase
      .from('cash_flow_entries')
      .insert({
        author: form.author.trim(),
        amount,
        description: form.description.trim(),
        entry_type: form.entryType,
      })
      .select('id,author,amount,description,entry_type,created_at')
      .single()

    if (error) {
      setMessage({ type: 'error', text: 'Não foi possível salvar o lançamento.' })
    } else {
      setEntries((current) => [{ ...data, amount: Number(data.amount) }, ...current])
      setForm(emptyCashEntry)
      setMessage({ type: 'success', text: 'Lançamento adicionado ao fluxo de caixa.' })
    }
    setSaving(false)
  }

  const deleteEntry = async (entry) => {
    const confirmed = window.confirm(`Excluir o lançamento “${entry.description}”?`)
    if (!confirmed) return

    setDeletingId(entry.id)
    setMessage(null)
    const { error } = await supabase.from('cash_flow_entries').delete().eq('id', entry.id)
    if (error) {
      setMessage({ type: 'error', text: 'Não foi possível excluir o lançamento.' })
    } else {
      setEntries((current) => current.filter((item) => item.id !== entry.id))
      setMessage({ type: 'success', text: 'Lançamento excluído.' })
    }
    setDeletingId(null)
  }

  return (
    <section id="cash-flow" className="dashboard-content cash-flow-page" aria-label="Fluxo de caixa">
      <header className="dashboard-header cash-flow-header">
        <div>
          <span className="dashboard-eyebrow">Controle financeiro</span>
          <h1>Fluxo de caixa</h1>
          <p>Registre entradas e saídas manuais e acompanhe o balanço da operação.</p>
        </div>
        <span className="cash-flow-reference"><Banknote size={18} /> Lançamentos em BRL</span>
      </header>

      <div className="cash-summary-grid">
        <article className="cash-summary-card income">
          <span><ArrowUpRight size={20} /></span>
          <div><small>Total de entradas</small><strong>{money(totals.income, 'BRL')}</strong></div>
        </article>
        <article className="cash-summary-card expense">
          <span><ArrowDownLeft size={20} /></span>
          <div><small>Total de saídas</small><strong>{money(totals.expenses, 'BRL')}</strong></div>
        </article>
        <article className={`cash-summary-card balance${balance < 0 ? ' negative' : ''}`}>
          <span><WalletCards size={20} /></span>
          <div><small>Saldo atual</small><strong>{money(balance, 'BRL')}</strong></div>
        </article>
      </div>

      {message && <div className={`cash-flow-message ${message.type}`} role="status">{message.text}</div>}

      <div className="cash-flow-grid">
        <article className="cash-entry-panel">
          <div className="cash-panel-heading">
            <span>Novo lançamento</span>
            <h2>Adicionar movimentação</h2>
          </div>

          <form className="cash-entry-form" onSubmit={saveEntry}>
            <div className="cash-field">
              <label htmlFor="cash-author">Autor</label>
              <input
                id="cash-author"
                type="text"
                value={form.author}
                onChange={updateCashField('author')}
                placeholder="Nome de quem registrou"
                maxLength={120}
                required
              />
            </div>

            <div className="cash-field">
              <label htmlFor="cash-amount">Valor</label>
              <div className="cash-amount-input">
                <span>R$</span>
                <input
                  id="cash-amount"
                  type="text"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={updateCashField('amount')}
                  placeholder="0,00"
                  required
                />
              </div>
            </div>

            <fieldset className="cash-type-field">
              <legend>Tipo de movimentação</legend>
              <div className="cash-type-toggle">
                <button
                  className={form.entryType === 'entrada' ? 'active income' : ''}
                  type="button"
                  aria-pressed={form.entryType === 'entrada'}
                  onClick={() => setForm((current) => ({ ...current, entryType: 'entrada' }))}
                >
                  <ArrowUpRight size={17} /> Entrada
                </button>
                <button
                  className={form.entryType === 'saida' ? 'active expense' : ''}
                  type="button"
                  aria-pressed={form.entryType === 'saida'}
                  onClick={() => setForm((current) => ({ ...current, entryType: 'saida' }))}
                >
                  <ArrowDownLeft size={17} /> Saída
                </button>
              </div>
            </fieldset>

            <div className="cash-field">
              <label htmlFor="cash-description">Descrição</label>
              <textarea
                id="cash-description"
                value={form.description}
                onChange={updateCashField('description')}
                placeholder="Descreva a origem ou finalidade do valor"
                rows={4}
                maxLength={500}
                required
              />
            </div>

            <button className="cash-submit-button" type="submit" disabled={saving}>
              {saving ? <LoaderCircle className="spin" size={18} /> : <Plus size={18} />}
              {saving ? 'Salvando...' : 'Adicionar lançamento'}
            </button>
          </form>
        </article>

        <article className="cash-history-panel">
          <div className="cash-panel-heading cash-history-heading">
            <div><span>Movimentações</span><h2>Histórico de lançamentos</h2></div>
            <b>{entries.length} {entries.length === 1 ? 'registro' : 'registros'}</b>
          </div>

          <div className="cash-history-scroll">
            {loading ? (
              <div className="cash-empty-state"><LoaderCircle className="spin" size={24} />Carregando lançamentos...</div>
            ) : entries.length === 0 ? (
              <div className="cash-empty-state">
                <WalletCards size={30} />
                <strong>Nenhum lançamento ainda</strong>
                <span>Adicione a primeira entrada ou saída usando o formulário.</span>
              </div>
            ) : (
              <div className="cash-history-table">
                <div className="cash-history-row cash-history-head">
                  <span>Data</span><span>Autor</span><span>Descrição</span><span>Tipo</span><span>Valor</span><span />
                </div>
                {entries.map((entry) => (
                  <div className="cash-history-row" key={entry.id}>
                    <div data-label="Data">{cashFlowDate(entry.created_at)}</div>
                    <div data-label="Autor" className="cash-author-cell">{entry.author}</div>
                    <div data-label="Descrição" className="cash-description-cell">{entry.description}</div>
                    <div data-label="Tipo">
                      <span className={`cash-entry-type ${entry.entry_type}`}>
                        {entry.entry_type === 'entrada' ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
                        {entry.entry_type === 'entrada' ? 'Entrada' : 'Saída'}
                      </span>
                    </div>
                    <div data-label="Valor" className={`cash-value ${entry.entry_type}`}>
                      {entry.entry_type === 'entrada' ? '+' : '−'} {money(entry.amount, 'BRL')}
                    </div>
                    <div className="cash-actions-cell">
                      <button
                        type="button"
                        aria-label={`Excluir ${entry.description}`}
                        title="Excluir lançamento"
                        disabled={deletingId === entry.id}
                        onClick={() => deleteEntry(entry)}
                      >
                        {deletingId === entry.id
                          ? <LoaderCircle className="spin" size={16} />
                          : <Trash2 size={16} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </article>
      </div>
    </section>
  )
}

function AuthenticatedView({ theme, onToggleTheme, onSignOut, loading }) {
  const [activePage, setActivePage] = useState('dashboard')

  return (
    <main className="dashboard-shell">
      <aside className="app-sidebar">
        <a className="brand dark-brand sidebar-brand" href="#dashboard" aria-label="Nutra X1 - dashboard" onClick={() => setActivePage('dashboard')}>
          <BrandMark />
          <span>Nutra X1</span>
        </a>

        <nav className="sidebar-nav" aria-label="Navegação principal">
          <button
            className={`sidebar-nav-item${activePage === 'dashboard' ? ' active' : ''}`}
            type="button"
            aria-current={activePage === 'dashboard' ? 'page' : undefined}
            onClick={() => setActivePage('dashboard')}
          >
            <LayoutDashboard size={19} />
            <span>Dashboard</span>
          </button>
          <button
            className={`sidebar-nav-item${activePage === 'cash-flow' ? ' active' : ''}`}
            type="button"
            aria-current={activePage === 'cash-flow' ? 'page' : undefined}
            onClick={() => setActivePage('cash-flow')}
          >
            <WalletCards size={19} />
            <span>Fluxo de caixa</span>
          </button>
        </nav>

        <div className="sidebar-controls">
          <button className="sidebar-control" type="button" onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
            <span>{theme === 'dark' ? 'Modo claro' : 'Modo escuro'}</span>
          </button>
          <button className="sidebar-control" type="button" onClick={onSignOut} disabled={loading}>
            <LogOut size={19} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      {activePage === 'dashboard' ? <Dashboard theme={theme} /> : <CashFlowPage />}
    </main>
  )
}

function getInitialTheme() {
  const storedTheme = window.localStorage.getItem('nutra-x1-theme')
  if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function App() {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState(initialForm)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(Boolean(supabase))
  const [message, setMessage] = useState(null)
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('nutra-x1-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!supabase) {
      return undefined
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setInitializing(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, currentSession) => {
      setSession(currentSession)
      if (event === 'PASSWORD_RECOVERY') {
        setMode('update-password')
        setMessage(null)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  const changeMode = (nextMode) => {
    setMode(nextMode)
    setMessage(null)
    setForm(initialForm)
  }

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
    if (message?.type === 'error') setMessage(null)
  }

  const requireConfig = () => {
    if (supabase) return true
    setMessage({ type: 'error', text: supabaseConfigError })
    return false
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!requireConfig()) return

    if (mode === 'update-password' && form.password !== form.confirmPassword) {
      setMessage({ type: 'error', text: 'As senhas não coincidem.' })
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        })
        if (error) throw error
      }

      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(form.email, {
          redirectTo: window.location.origin,
        })
        if (error) throw error
        setMessage({
          type: 'success',
          text: 'Se o e-mail estiver cadastrado, você receberá as instruções em instantes.',
        })
      }

      if (mode === 'update-password') {
        const { error } = await supabase.auth.updateUser({ password: form.password })
        if (error) throw error
        setMessage({ type: 'success', text: 'Senha atualizada com sucesso.' })
        setTimeout(() => setMode('login'), 1400)
      }
    } catch (error) {
      setMessage({ type: 'error', text: friendlyError(error.message) })
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => {
    setLoading(true)
    await supabase.auth.signOut()
    setSession(null)
    setMode('login')
    setLoading(false)
  }

  const toggleTheme = () => {
    setTheme((currentTheme) => currentTheme === 'dark' ? 'light' : 'dark')
  }

  if (initializing) {
    return <div className="page-loader"><LoaderCircle className="spin" size={30} /><span>Carregando...</span></div>
  }

  if (session && mode !== 'update-password') {
    return (
      <AuthenticatedView
        theme={theme}
        onToggleTheme={toggleTheme}
        onSignOut={handleSignOut}
        loading={loading}
      />
    )
  }

  const isLogin = mode === 'login'
  const isForgot = mode === 'forgot'
  const isUpdate = mode === 'update-password'
  const title = isLogin
    ? 'Bem-vindo de volta'
    : isForgot
      ? 'Recupere seu acesso'
      : 'Crie uma nova senha'
  const subtitle = isLogin
    ? 'Acesse sua conta e continue de onde parou.'
    : isForgot
      ? 'Digite seu e-mail e enviaremos um link seguro.'
      : 'Escolha uma senha forte para proteger sua conta.'

  return (
    <main className="auth-layout">
      <section className="brand-panel">
        <div className="panel-noise" />
        <a className="brand" href="/" aria-label="Nutra X1 - início">
          <BrandMark />
          <span>Nutra X1</span>
        </a>

        <div className="brand-content">
          <div className="badge"><Sparkles size={15} /> Simples. Seguro. Seu.</div>
          <h1>Métricas e dashboards da operação.</h1>
          <p>Acompanhe indicadores, visualize resultados e tome decisões mais inteligentes em um só lugar.</p>

          <div className="feature-list">
            <div><span><ShieldCheck size={18} /></span><p><strong>Seus dados protegidos</strong><small>Segurança em cada etapa da sua jornada.</small></p></div>
            <div><span><Sparkles size={18} /></span><p><strong>Uma experiência fluida</strong><small>Feito para você focar no que importa.</small></p></div>
          </div>
        </div>

        <div className="visual-card" aria-hidden="true">
          <div className="visual-top"><span /><span /><span /></div>
          <div className="visual-body">
            <div className="visual-sidebar"><i /><i /><i /><i /></div>
            <div className="visual-content">
              <div className="visual-heading"><span /><small /></div>
              <div className="visual-stats"><span /><span /><span /></div>
              <div className="visual-chart"><i /><i /><i /><i /><i /><i /><b /></div>
            </div>
          </div>
        </div>

        <p className="panel-footer">© 2026 Nutra X1. Todos os direitos reservados.</p>
      </section>

      <section className="form-panel">
        <button
          className="auth-theme-toggle"
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
          title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        >
          {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>
        <div className="mobile-brand">
          <a className="brand dark-brand" href="/" aria-label="Nutra X1 - início"><BrandMark /><span>Nutra X1</span></a>
        </div>
        <div className="form-container">
          {(isForgot || isUpdate) && (
            <button className="back-button" type="button" onClick={() => changeMode('login')}>
              <ArrowLeft size={17} /> Voltar para o login
            </button>
          )}

          <div className="form-heading">
            <span className="eyebrow">{isForgot || isUpdate ? 'Segurança da conta' : 'Acesse sua conta'}</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>

          <form onSubmit={handleSubmit}>
            {!isUpdate && (
              <div className="field-group">
                <label htmlFor="email">E-mail</label>
                <div className="input-wrap">
                  <Mail size={18} aria-hidden="true" />
                  <input id="email" type="email" value={form.email} onChange={updateField('email')} placeholder="voce@exemplo.com" autoComplete="email" required />
                </div>
              </div>
            )}

            {!isForgot && (
              <>
                <PasswordField id="password" label={isUpdate ? 'Nova senha' : 'Senha'} value={form.password} onChange={updateField('password')} autoComplete={isLogin ? 'current-password' : 'new-password'} />
                {isUpdate && (
                  <PasswordField id="confirm-password" label="Confirme sua senha" value={form.confirmPassword} onChange={updateField('confirmPassword')} autoComplete="new-password" placeholder="Repita sua senha" />
                )}
              </>
            )}

            {isLogin && (
              <div className="form-options">
                <button type="button" onClick={() => changeMode('forgot')}>Esqueci minha senha</button>
              </div>
            )}

            {message && <div className={`form-message ${message.type}`} role="status">{message.text}</div>}

            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? <LoaderCircle className="spin" size={19} /> : (
                <>{isLogin ? 'Entrar na minha conta' : isForgot ? 'Enviar link de recuperação' : 'Salvar nova senha'}<ArrowRight size={18} /></>
              )}
            </button>
          </form>
        </div>
      </section>
    </main>
  )
}

export default App
