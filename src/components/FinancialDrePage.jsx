import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { calculateBreakEvenBars } from '../lib/financialDreBars'
import { parseFinancialDecimal } from '../lib/financialDreSettings'

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })

function currentMonth() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year').value
  const month = parts.find((part) => part.type === 'month').value
  return `${year}-${month}`
}

function formatMoney(value) {
  return value == null ? '—' : currency.format(Number(value))
}

function FinancialBars({ row }) {
  const totalCost = row.total_cost == null ? null : Number(row.total_cost)
  const paid = Number(row.confirmed_revenue)
  const bars = calculateBreakEvenBars(totalCost, paid)

  if (bars.costPercent === null) {
    const missing = [row.salary_cost == null && 'salário', row.commission_pct == null && 'comissão'].filter(Boolean)
    return <p className="dre-pending" role="status">
      {row.units_pending ? 'Quantidade de produtos pendente.' : `Pendente: ${missing.join(' e ')}.`}
    </p>
  }

  const scale = Math.max(totalCost, paid, 1)
  return <div className="dre-bars" aria-label={`Ponto de equilíbrio de ${row.seller_name}`}>
    <div className="dre-bar-row">
      <div className="dre-bar-label"><span>Custo total</span><strong>{formatMoney(totalCost)}</strong></div>
      <div className="dre-bar-track" role="meter" aria-label="Custo total"
        aria-valuemin={0} aria-valuemax={scale} aria-valuenow={totalCost}>
        <span className="dre-bar-fill cost" style={{ width: `${bars.costPercent}%` }} />
      </div>
    </div>
    <div className="dre-bar-row">
      <div className="dre-bar-label"><span>Vendas pagas</span><strong>{formatMoney(paid)}</strong></div>
      <div className="dre-bar-track" role="meter" aria-label="Vendas pagas"
        aria-valuemin={0} aria-valuemax={scale} aria-valuenow={paid}>
        <span className="dre-bar-fill paid" style={{ width: `${bars.paidPercent}%` }} />
      </div>
    </div>
    <p className={`dre-break-even ${bars.remaining > 0 ? 'shortfall' : 'surplus'}`}>
      {bars.remaining > 0 ? `Faltam ${formatMoney(bars.remaining)} para se pagar`
        : bars.surplus > 0 ? `${formatMoney(bars.surplus)} acima do ponto de equilíbrio`
          : 'No ponto de equilíbrio'}
    </p>
  </div>
}

function CostDetails({ row }) {
  return <details className="dre-cost-details">
    <summary>Detalhar valores</summary>
    <dl>
      <div><dt>Faturamento agendado</dt><dd>{formatMoney(row.scheduled_revenue)}</dd></div>
      <div><dt>Salário</dt><dd>{formatMoney(row.salary_cost)}</dd></div>
      <div><dt>Comissão{row.commission_pct == null ? '' : ` (${Number(row.commission_pct).toLocaleString('pt-BR')}%)`}</dt><dd>{formatMoney(row.commission_cost)}</dd></div>
      <div><dt>Fabricação ({row.product_units} unidades)</dt><dd>{formatMoney(row.production_cost)}</dd></div>
      <div><dt>Frete ({row.order_count} pedidos)</dt><dd>{formatMoney(row.shipping_cost)}</dd></div>
      <div><dt>Tráfego</dt><dd>{formatMoney(row.traffic_cost)}</dd></div>
      <div className="dre-cost-total"><dt>Custo total</dt><dd>{formatMoney(row.total_cost)}</dd></div>
      <div><dt>Saldo confirmado</dt><dd>{formatMoney(row.confirmed_balance)}</dd></div>
    </dl>
  </details>
}

export default function FinancialDrePage() {
  const [month, setMonth] = useState(currentMonth)
  const [rows, setRows] = useState([])
  const [settings, setSettings] = useState([])
  const [sellers, setSellers] = useState([])
  const [selectedSellerId, setSelectedSellerId] = useState('')
  const [draft, setDraft] = useState({ key: '', salary: '', commission: '' })
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const monthDate = `${month}-01`
  const monthLabel = monthFormatter.format(new Date(`${monthDate}T12:00:00Z`))

  useEffect(() => {
    const timer = window.setInterval(() => setRevision((value) => value + 1), 60000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let active = true
    const load = async () => {
      setError('')
      const [dre, settingsResult, sellersResult] = await Promise.all([
        supabase.rpc('get_financial_dre', { p_month: monthDate }),
        supabase.from('seller_financial_settings')
          .select('seller_id,effective_month,monthly_salary,commission_pct')
          .lte('effective_month', monthDate)
          .order('effective_month', { ascending: false }),
        supabase.rpc('get_dashboard_sellers'),
      ])
      if (!active) return
      if (dre.error || settingsResult.error || sellersResult.error) {
        setRows([])
        setError('Não foi possível carregar o DRE financeiro. Tente novamente.')
      } else {
        setRows(dre.data || [])
        setSettings(settingsResult.data || [])
        setSellers(sellersResult.data || [])
      }
      setLoading(false)
    }
    load()
    return () => { active = false }
  }, [monthDate, revision])

  const sellerOptions = useMemo(() => {
    const byId = new Map(sellers.map((seller) => [seller.id, seller.name]))
    rows.filter((row) => row.seller_id).forEach((row) => byId.set(row.seller_id, row.seller_name))
    return [...byId].map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [sellers, rows])

  const sellerId = sellerOptions.some((seller) => seller.id === selectedSellerId)
    ? selectedSellerId : sellerOptions[0]?.id || ''
  const selectedRow = rows.find((row) => row.seller_id === sellerId)

  const selectedSetting = settings.find((setting) =>
    setting.seller_id === sellerId && setting.effective_month === monthDate)
  const currentRate = settings.find((setting) =>
    setting.seller_id === sellerId && setting.commission_pct != null)
  const draftKey = `${sellerId}:${monthDate}`
  const salaryInput = draft.key === draftKey ? draft.salary
    : selectedSetting?.monthly_salary == null ? '' : String(selectedSetting.monthly_salary)
  const commissionInput = draft.key === draftKey ? draft.commission
    : currentRate?.commission_pct == null ? '' : String(currentRate.commission_pct)

  async function saveSettings(event) {
    event.preventDefault()
    const salary = salaryInput.trim() ? parseFinancialDecimal(salaryInput, 999999999999.99) : null
    const commission = commissionInput.trim() ? parseFinancialDecimal(commissionInput, 100) : null
    if (!sellerId || (salaryInput.trim() && salary === null) ||
      (commissionInput.trim() && commission === null)) {
      setNotice('Confira o salário e a comissão. Use valores positivos com até duas casas decimais; comissão até 100%.')
      return
    }
    const changes = {}
    if (salary !== null && (selectedSetting?.monthly_salary == null || salary !== Number(selectedSetting.monthly_salary))) changes.monthly_salary = salary
    if (commission !== null && commission !== Number(currentRate?.commission_pct)) changes.commission_pct = commission
    if (!Object.keys(changes).length) {
      setNotice(selectedSetting?.monthly_salary == null
        ? 'Informe o salário deste mês ou altere a comissão para salvar.'
        : 'Nenhuma alteração para salvar.')
      return
    }
    setSaving(true)
    setNotice('')
    const target = supabase.from('seller_financial_settings')
    const result = selectedSetting
      ? await target.update(changes).eq('seller_id', sellerId).eq('effective_month', monthDate)
      : await target.insert({ seller_id: sellerId, effective_month: monthDate, ...changes })
    if (result.error) {
      setNotice('Não foi possível salvar. Recarregue a página e tente novamente.')
    } else {
      setSettings((previous) => [{
        seller_id: sellerId, effective_month: monthDate,
        monthly_salary: selectedSetting?.monthly_salary ?? null,
        commission_pct: selectedSetting?.commission_pct ?? null,
        ...changes,
      }, ...previous.filter((setting) =>
        setting.seller_id !== sellerId || setting.effective_month !== monthDate)])
      const missing = [
        changes.monthly_salary == null && selectedSetting?.monthly_salary == null && 'salário deste mês',
        changes.commission_pct == null && currentRate?.commission_pct == null && 'comissão',
      ].filter(Boolean)
      setNotice(missing.length
        ? `Valores salvos. Falta cadastrar ${missing.join(' e ')} para completar o DRE.`
        : 'Configuração salva. O DRE foi atualizado.')
      setDraft({ key: '', salary: '', commission: '' })
      setRevision((value) => value + 1)
    }
    setSaving(false)
  }

  const general = rows.find((row) => row.row_type === 'general')
  const sellerRows = rows.filter((row) => row.row_type === 'seller')
  const unassigned = rows.find((row) => row.row_type === 'unassigned')

  return <section id="financial-dre" className="dashboard-content dre-page" aria-labelledby="dre-title">
    <header className="dashboard-header dre-header">
      <div>
        <span className="dashboard-eyebrow">Controle financeiro</span>
        <h1 id="dre-title">DRE financeiro</h1>
        <p>Custos do mês dos pedidos e pagamentos confirmados desses mesmos pedidos.</p>
      </div>
      <label className="dre-month-label" htmlFor="dre-month">Mês de referência
        <input id="dre-month" type="month" value={month}
          onChange={(event) => { if (event.target.value) { setMonth(event.target.value); setLoading(true); setNotice('') } }} />
      </label>
    </header>

    {error && <p className="dre-error" role="alert">{error}</p>}
    {!loading && !error && <section className="dre-settings" aria-labelledby="dre-settings-title">
      <div className="dre-settings-heading">
        <div>
          <h2 id="dre-settings-title">Configurar vendedor</h2>
          <p>Salário vale só para {monthLabel}. A comissão continua nos próximos meses até você alterar.</p>
        </div>
        {selectedRow?.configuration_pending && <span className="dre-settings-badge">Configuração pendente</span>}
      </div>
      {notice && <p role="status" className="dre-notice">{notice}</p>}
      <form className="dre-settings-form" onSubmit={saveSettings}>
        <label htmlFor="dre-seller">Vendedor
          <select id="dre-seller" value={sellerId} disabled={saving}
            onChange={(event) => { setSelectedSellerId(event.target.value); setNotice('') }}>
            {sellerOptions.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
          </select>
        </label>
        {sellerId && <>
          <div className="dre-settings-fields">
            <label htmlFor="dre-salary">Salário de {monthLabel} (R$)
              <input id="dre-salary" inputMode="decimal" value={salaryInput}
                onChange={(event) => setDraft({ key: draftKey, salary: event.target.value, commission: commissionInput })}
                placeholder="Ex.: 1.000,00" />
              <small>{selectedSetting?.monthly_salary == null ? 'Ainda não lançado neste mês.' : 'Lançado para este mês.'} Não se repete automaticamente.</small>
            </label>
            <label htmlFor="dre-commission">Comissão sobre vendas agendadas (%)
              <input id="dre-commission" inputMode="decimal" value={commissionInput}
                onChange={(event) => setDraft({ key: draftKey, salary: salaryInput, commission: event.target.value })}
                placeholder="Ex.: 8,00" />
              <small>{currentRate
                ? `Vigente: ${Number(currentRate.commission_pct).toLocaleString('pt-BR')}% desde ${currentRate.effective_month.slice(0, 7)}. Alterações valem a partir de ${monthLabel}.`
                : `Sem comissão vigente. A taxa cadastrada valerá a partir de ${monthLabel}.`}</small>
            </label>
          </div>
          <button type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar configuração'}</button>
        </>}
      </form>
    </section>}
    {loading ? <p role="status">Carregando dados financeiros…</p> : !error && <>
      <section className="dre-summary" aria-label={`Resumo de ${monthLabel}`}>
        <article><span>Faturamento agendado</span><strong>{formatMoney(general?.scheduled_revenue)}</strong></article>
        <article><span>Vendas pagas</span><strong>{formatMoney(general?.confirmed_revenue)}</strong></article>
        <article><span>Custo total</span><strong>{formatMoney(general?.total_cost)}</strong></article>
        <article><span>Saldo confirmado</span><strong>{formatMoney(general?.confirmed_balance)}</strong></article>
        <article><span>Falta para se pagar</span><strong>{formatMoney(general?.remaining_to_break_even)}</strong></article>
      </section>
      {(general?.configuration_pending || general?.units_pending) &&
        <p className="dre-pending" role="status">O DRE está incompleto: configure os valores pendentes para calcular o custo total.</p>}
      {general && <CostDetails row={general} />}

      <section className="dre-seller-list" aria-label="Resultado por vendedor">
        <h2>Vendedores</h2>
        {sellerRows.length === 0 && <p>Nenhum vendedor com custos ou pedidos neste mês.</p>}
        {sellerRows.map((row) => <article className="dre-seller-card" key={row.seller_id}>
          <div className="dre-seller-heading"><h3>{row.seller_name}</h3><span>{formatMoney(row.scheduled_revenue)} agendados</span></div>
          <FinancialBars row={row} />
          {row.configuration_pending && <button className="dre-configure-link" type="button" onClick={() => {
            setSelectedSellerId(row.seller_id)
            document.getElementById(row.salary_cost == null ? 'dre-salary' : 'dre-commission')?.focus()
          }}>Configurar {row.seller_name}</button>}
          <CostDetails row={row} />
        </article>)}
        {unassigned && <article className="dre-seller-card" aria-label="Valores não atribuídos">
          <div className="dre-seller-heading"><h3>Não atribuído</h3><span>{formatMoney(unassigned.confirmed_revenue)} pagos</span></div>
          <CostDetails row={unassigned} />
        </article>}
      </section>
    </>}

  </section>
}
