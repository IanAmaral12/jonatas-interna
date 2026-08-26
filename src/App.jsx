import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { supabase, supabaseConfigError } from './lib/supabase'
import './App.css'

const initialForm = { name: '', email: '', password: '', confirmPassword: '' }

const errorMessages = {
  'Invalid login credentials': 'E-mail ou senha incorretos.',
  'Email not confirmed': 'Confirme seu e-mail antes de entrar.',
  'User already registered': 'Já existe uma conta com este e-mail.',
  'Password should be at least 6 characters': 'A senha deve ter pelo menos 6 caracteres.',
  'Unable to validate email address: invalid format': 'Digite um endereço de e-mail válido.',
  'Signup requires a valid password': 'Digite uma senha válida.',
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

function AuthenticatedView({ session, onSignOut, loading }) {
  const displayName = session.user.user_metadata?.name || session.user.email?.split('@')[0]

  return (
    <main className="success-page">
      <div className="success-glow" />
      <header className="success-header">
        <a className="brand dark-brand" href="/" aria-label="Nutra X1 - início">
          <BrandMark />
          <span>Nutra X1</span>
        </a>
        <button className="signout-button" type="button" onClick={onSignOut} disabled={loading}>
          <LogOut size={17} />
          Sair
        </button>
      </header>
      <section className="success-card">
        <div className="success-icon"><Check size={31} strokeWidth={2.5} /></div>
        <p className="eyebrow">Acesso liberado</p>
        <h1>Que bom ter você aqui, {displayName}!</h1>
        <p>Sua autenticação com o Supabase foi concluída e a sessão está ativa.</p>
        <div className="user-summary">
          <div className="avatar">{displayName?.charAt(0).toUpperCase()}</div>
          <div>
            <strong>{displayName}</strong>
            <span>{session.user.email}</span>
          </div>
          <span className="status"><i /> Ativo</span>
        </div>
      </section>
    </main>
  )
}

function App() {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState(initialForm)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(Boolean(supabase))
  const [message, setMessage] = useState(null)

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

    if ((mode === 'signup' || mode === 'update-password') && form.password !== form.confirmPassword) {
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

      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: {
            data: { name: form.name },
            emailRedirectTo: window.location.origin,
          },
        })
        if (error) throw error
        if (!data.session) {
          setMessage({
            type: 'success',
            text: 'Conta criada! Enviamos um link de confirmação para o seu e-mail.',
          })
        }
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

  if (initializing) {
    return <div className="page-loader"><LoaderCircle className="spin" size={30} /><span>Carregando...</span></div>
  }

  if (session && mode !== 'update-password') {
    return <AuthenticatedView session={session} onSignOut={handleSignOut} loading={loading} />
  }

  const isLogin = mode === 'login'
  const isSignup = mode === 'signup'
  const isForgot = mode === 'forgot'
  const isUpdate = mode === 'update-password'
  const title = isLogin
    ? 'Bem-vindo de volta'
    : isSignup
      ? 'Crie sua conta'
      : isForgot
        ? 'Recupere seu acesso'
        : 'Crie uma nova senha'
  const subtitle = isLogin
    ? 'Acesse sua conta e continue de onde parou.'
    : isSignup
      ? 'Comece agora. É rápido, seguro e gratuito.'
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
            <span className="eyebrow">{isSignup ? 'Junte-se a nós' : isForgot || isUpdate ? 'Segurança da conta' : 'Acesse sua conta'}</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>

          <form onSubmit={handleSubmit}>
            {isSignup && (
              <div className="field-group">
                <label htmlFor="name">Nome completo</label>
                <div className="input-wrap">
                  <UserRound size={18} aria-hidden="true" />
                  <input id="name" type="text" value={form.name} onChange={updateField('name')} placeholder="Como podemos chamar você?" autoComplete="name" required />
                </div>
              </div>
            )}

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
                {isSignup && <p className="password-hint">Use pelo menos 6 caracteres.</p>}
                {(isSignup || isUpdate) && (
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
                <>{isLogin ? 'Entrar na minha conta' : isSignup ? 'Criar minha conta' : isForgot ? 'Enviar link de recuperação' : 'Salvar nova senha'}<ArrowRight size={18} /></>
              )}
            </button>
          </form>

          {(isLogin || isSignup) && (
            <p className="switch-mode">
              {isLogin ? 'Ainda não tem uma conta?' : 'Já tem uma conta?'}{' '}
              <button type="button" onClick={() => changeMode(isLogin ? 'signup' : 'login')}>
                {isLogin ? 'Criar conta grátis' : 'Entrar agora'}
              </button>
            </p>
          )}

          {isSignup && <p className="terms">Ao criar sua conta, você concorda com nossos <a href="#termos">Termos de Uso</a> e <a href="#privacidade">Política de Privacidade</a>.</p>}
        </div>
      </section>
    </main>
  )
}

export default App
