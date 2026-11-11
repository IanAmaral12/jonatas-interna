import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import FinancialCostsPage from './FinancialCostsPage'
import FinancialDashboardPage from './FinancialDashboardPage'
import SellerFinancialRankingPage from './SellerFinancialRankingPage'

function currentMonth() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  return `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}`
}

const titles = { dashboard: 'Dashboard financeiro', ranking: 'Ranking de vendedores', costs: 'Custos' }
const tabs = { dashboard: 'Visão geral', ranking: 'Ranking', costs: 'Custos' }

export default function FinancialWorkspace({ view = 'dashboard', onViewChange }) {
  const [month, setMonth] = useState(currentMonth)
  const [snapshot, setSnapshot] = useState(null)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [sellerId, setSellerId] = useState(null)
  const monthDate = `${month}-01`
  const data = snapshot?.month === monthDate ? snapshot : null
  const refresh = () => setRevision((previous) => previous + 1)

  useEffect(() => {
    const interval = window.setInterval(() => setRevision((previous) => previous + 1), 60000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    let active = true
    async function load() {
      setRefreshing(true)
      try {
        const result = await supabase.rpc('get_financial_workspace', { p_month: monthDate })
        if (result.error || !result.data) throw result.error || new Error('Consulta sem dados')
        if (active) { setSnapshot(result.data); setError('') }
      } catch {
        if (active) setError('Não foi possível atualizar os dados financeiros. Tente novamente. Se houver valores abaixo, eles são da última consulta concluída.')
      } finally {
        if (active) setRefreshing(false)
      }
    }
    load()
    return () => { active = false }
  }, [monthDate, revision])

  function configure(id) {
    setSellerId(id)
    onViewChange('costs')
  }

  return <section className="dashboard-content fw-page" aria-labelledby="fw-title">
    <header className="dashboard-header fw-header"><div><h1 id="fw-title">{titles[view]}</h1><p>{view === 'costs' ? 'Gerencie a remuneração e os lançamentos do mês.' : view === 'ranking' ? 'Compare o lucro confirmado e a evolução até o equilíbrio.' : 'Resultado consolidado dos pedidos do mês.'}</p></div>
      <div className="fw-header-controls"><label htmlFor="fw-month">Mês de referência<input id="fw-month" type="month" value={month} onChange={(event) => { if (/^\d{4}-\d{2}$/.test(event.target.value)) { setMonth(event.target.value); setError('') } }} /></label><button type="button" className="fw-secondary" disabled={refreshing} onClick={refresh}>{refreshing ? 'Atualizando…' : 'Atualizar'}</button></div>
    </header>
    <div className="fw-navigation"><nav className="fw-tabs" aria-label="Seções do financeiro">{Object.entries(tabs).map(([key, title]) => <button type="button" key={key} aria-current={view === key ? 'page' : undefined} className={view === key ? 'active' : ''} onClick={() => onViewChange(key)}>{title}</button>)}</nav>
      <details className="fw-period-help"><summary>Sobre o período</summary><p>Os pedidos pertencem ao mês de criação. Pagamentos posteriores atualizam o resultado desse mesmo mês.</p></details></div>
    {error && <p className="fw-message error" role="alert">{error} <button type="button" className="fw-link" onClick={refresh}>Tentar novamente</button></p>}
    {!data && !error && <p role="status">Carregando dados financeiros…</p>}
    {data && <>
      {view === 'dashboard' && <FinancialDashboardPage data={data} onConfigure={configure} />}
      {view === 'ranking' && <SellerFinancialRankingPage data={data} onConfigure={configure} />}
      <FinancialCostsPage data={data} month={month} sellerId={sellerId} onSelectSeller={setSellerId} onRefresh={refresh} active={view === 'costs'} />
    </>}
  </section>
}
