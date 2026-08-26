import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CircleDollarSign,
  Eye,
  EyeOff,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  TrendingDown,
  Users,
} from 'lucide-react'
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

function money(value, currency) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
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
        setError('Não foi possível carregar os dados de CPA.')
        setRows([])
      } else {
        setRows((data || []).map((row) => ({
          ...row,
          spend: Number(row.spend || 0),
          appointments: Number(row.appointments || 0),
          cpa: row.cpa === null ? null : Number(row.cpa),
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
    appointments: general?.appointments || 0,
    cpa: general?.cpa ?? null,
  }
  const ranking = currencyRows
    .filter((row) => row.seller_id && !row.currency_conflict)
    .sort((first, second) => {
      if (first.cpa === null) return 1
      if (second.cpa === null) return -1
      return first.cpa - second.cpa
    })
  const chartRows = ranking.filter((row) => row.cpa !== null)
  const bestSeller = chartRows[0]
  const unmappedSpend = currencyRows
    .filter((row) => row.mapping_status !== 'matched')
    .reduce((total, row) => total + row.spend, 0)
  const conflicts = currencyRows.filter((row) => row.currency_conflict).length

  const chartData = {
    labels: chartRows.map((row) => row.seller_name.split(' ')[0]),
    datasets: [{
      label: `CPA em ${currency}`,
      data: chartRows.map((row) => row.cpa),
      backgroundColor: chartRows.map((_, index) =>
        index === 0 ? '#ff7a1a' : `rgba(255, 122, 26, ${Math.max(.28, .72 - index * .08)})`
      ),
      borderColor: '#ff7a1a',
      borderWidth: 1,
      borderRadius: 7,
      barThickness: 24,
    }],
  }
  const chartOptions = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => ` CPA: ${money(context.raw, currency)}`,
          afterLabel: (context) => {
            const row = chartRows[context.dataIndex]
            return [`Investimento: ${money(row.spend, currency)}`, `Agendamentos: ${row.appointments}`]
          },
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        grid: { color: theme === 'dark' ? 'rgba(255,255,255,.07)' : 'rgba(24,20,17,.08)' },
        ticks: { color: theme === 'dark' ? '#aaa19a' : '#746c66' },
      },
      y: {
        grid: { display: false },
        ticks: { color: theme === 'dark' ? '#fbfaf8' : '#181411', font: { weight: 600 } },
      },
    },
  }

  const applyFilters = (event) => {
    event.preventDefault()
    if (filters.start <= filters.end) setAppliedFilters({ ...filters })
  }

  return (
    <section id="dashboard" className="dashboard-content" aria-label="Dashboard de CPA">
      <header className="dashboard-header">
        <div>
          <span className="dashboard-eyebrow">Visão de performance</span>
          <h1>Dashboard de CPA</h1>
          <p>Custo por agendamento com pedidos cancelados desconsiderados.</p>
        </div>
        <form className="period-filter" onSubmit={applyFilters}>
          <CalendarDays size={18} />
          <label>
            <span>De</span>
            <input type="date" value={filters.start} max={filters.end} onChange={(event) => setFilters((current) => ({ ...current, start: event.target.value }))} />
          </label>
          <label>
            <span>Até</span>
            <input type="date" value={filters.end} min={filters.start} onChange={(event) => setFilters((current) => ({ ...current, end: event.target.value }))} />
          </label>
          <button type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={17} /> : 'Aplicar'}</button>
        </form>
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
          <div className="metric-icon"><Users size={20} /></div>
          <div className="metric-label"><span>Agendamentos</span><b>{currency}</b></div>
          <strong>{summary.appointments}</strong>
          <small>Todos os pedidos não cancelados</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon"><Sparkles size={20} /></div>
          <div className="metric-label"><span>Melhor CPA</span><b>BRL</b></div>
          <strong>{bestSeller ? money(bestSeller.cpa, currency) : '—'}</strong>
          <small>{bestSeller?.seller_name || 'Aguardando dados'}</small>
        </article>
      </div>

      {(unmappedSpend > 0 || conflicts > 0) && (
        <div className="dashboard-alert"><AlertTriangle size={18} />
          {unmappedSpend > 0 && `${money(unmappedSpend, currency)} ainda sem vendedor. `}
          {conflicts > 0 && `${conflicts} vendedor(es) com investimento em mais de uma moeda.`}
        </div>
      )}

      <article className="ranking-card">
        <div className="ranking-header">
          <div><span>Eficiência por vendedor</span><h2>Ranking de menor CPA</h2></div>
          <span className="currency-reference">Valores convertidos em BRL</span>
        </div>
        <div className="chart-area">
          {loading ? <div className="dashboard-empty"><LoaderCircle className="spin" size={24} />Atualizando métricas...</div>
            : chartRows.length > 0 ? <Bar data={chartData} options={chartOptions} />
              : <div className="dashboard-empty"><TrendingDown size={28} /><strong>Sem dados para o período</strong><span>O ranking aparecerá após a primeira sincronização da Meta.</span></div>}
        </div>
      </article>
    </section>
  )
}

function AuthenticatedView({ theme, onToggleTheme, onSignOut, loading }) {
  return (
    <main className="dashboard-shell">
      <aside className="app-sidebar">
        <a className="brand dark-brand sidebar-brand" href="#dashboard" aria-label="Nutra X1 - dashboard">
          <BrandMark />
          <span>Nutra X1</span>
        </a>

        <nav className="sidebar-nav" aria-label="Navegação principal">
          <a className="sidebar-nav-item active" href="#dashboard" aria-current="page">
            <LayoutDashboard size={19} />
            <span>Dashboard</span>
          </a>
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

      <Dashboard theme={theme} />
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
