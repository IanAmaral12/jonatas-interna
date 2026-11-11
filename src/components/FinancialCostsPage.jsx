import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { parseFinancialDecimal } from '../lib/financialDreSettings'
import { formatMoney, formatMonth, formatPercent, sellerSettingChanges } from '../lib/financialWorkspace'
import { PendingReasons } from './FinancialComponents'

export default function FinancialCostsPage({ data, month, sellerId, onSelectSeller, onRefresh, active, onRanking }) {
  const [drafts, setDrafts] = useState({})
  const [taxDrafts, setTaxDrafts] = useState({})
  const [expenseDrafts, setExpenseDrafts] = useState({})
  const [savedSellerKeys, setSavedSellerKeys] = useState(() => new Set())
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const monthDate = `${month}-01`
  const label = formatMonth(month)
  const setting = data.seller_settings.find((entry) => entry.seller_id === sellerId)
  const key = `${month}:${sellerId}`
  const draft = drafts[key] || {
    salary: setting?.monthly_salary == null ? '' : String(setting.monthly_salary),
    commission: setting?.commission_pct == null ? '' : String(setting.commission_pct),
  }
  const taxInput = taxDrafts[month] ?? (data.tax == null ? '' : String(data.tax.tax_paid))
  const expenseDraft = expenseDrafts[month]

  useEffect(() => {
    if (active && sellerId) document.getElementById('fw-salary')?.focus()
  }, [active, sellerId])

  const updateDraft = (field, value) => setDrafts((previous) => ({ ...previous, [key]: { ...draft, [field]: value, dirty: { ...draft.dirty, [field]: true } } }))
  const updateExpense = (field, value) => setExpenseDrafts((previous) => ({ ...previous, [month]: { ...expenseDraft, [field]: value } }))

  async function mutate(action, success) {
    setSaving(true)
    setMessage(null)
    try {
      const result = await action()
      if (result.error) throw result.error
      setMessage({ text: success, error: false })
      onRefresh()
      return true
    } catch {
      setMessage({ text: 'Não foi possível salvar. Os dados digitados foram preservados. Tente novamente; se o problema continuar, atualize a consulta.', error: true })
      return false
    } finally {
      setSaving(false)
    }
  }

  async function saveSeller(event) {
    event.preventDefault()
    let changes
    try { changes = sellerSettingChanges(setting, draft) }
    catch (error) { setMessage({ text: error.message, error: true }); return }
    if (!Object.keys(changes).length) { setMessage({ text: 'Nenhuma alteração para salvar. Informe o salário do mês ou altere a comissão.', error: false }); return }
    const exists = savedSellerKeys.has(key) || setting.monthly_salary != null || setting.month_commission_pct != null
    const saved = await mutate(() => exists
      ? supabase.from('seller_financial_settings').update(changes).eq('seller_id', sellerId).eq('effective_month', monthDate)
      : supabase.from('seller_financial_settings').insert({ seller_id: sellerId, effective_month: monthDate, ...changes }),
    `Remuneração de ${setting.seller_name} salva para ${label}.`)
    if (saved) {
      setSavedSellerKeys((previous) => new Set(previous).add(key))
      setDrafts((previous) => {
        const next = { ...previous }
        delete next[key]
        return next
      })
    }
  }

  async function saveTax(event) {
    event.preventDefault()
    const amount = parseFinancialDecimal(taxInput, 999999999999.99)
    if (amount === null) { setMessage({ text: 'Informe o imposto pago com até duas casas decimais. Zero é válido.', error: true }); return }
    await mutate(() => supabase.from('financial_monthly_taxes').upsert({ month_start: monthDate, tax_paid: amount }, { onConflict: 'month_start' }), 'Imposto do mês salvo.')
  }

  async function deleteTax() {
    if (!window.confirm(`Excluir permanentemente o imposto de ${label}, no valor de ${formatMoney(data.tax.tax_paid)}? O mês voltará ao estado “Não lançado”.`)) return
    const deleted = await mutate(() => supabase.from('financial_monthly_taxes').delete().eq('month_start', monthDate), 'Lançamento de imposto excluído.')
    if (deleted) setTaxDrafts((previous) => ({ ...previous, [month]: '' }))
  }

  async function saveExpense(event) {
    event.preventDefault()
    const amount = parseFinancialDecimal(expenseDraft.amount, 999999999999.99)
    const description = expenseDraft.description.trim()
    if (amount == null || amount <= 0 || !description || description.length > 200 || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDraft.cost_date) || !expenseDraft.cost_date.startsWith(`${month}-`)) {
      setMessage({ text: 'Confira a despesa: descrição de até 200 caracteres, valor maior que zero e data no mês selecionado.', error: true }); return
    }
    const values = { description, amount, cost_date: expenseDraft.cost_date }
    const saved = await mutate(() => expenseDraft.id
      ? supabase.from('financial_cost_entries').update(values).eq('id', expenseDraft.id)
      : supabase.from('financial_cost_entries').insert(values), 'Despesa salva.')
    if (saved) setExpenseDrafts((previous) => ({ ...previous, [month]: null }))
  }

  async function deleteExpense(entry) {
    if (!window.confirm(`Excluir permanentemente a despesa “${entry.description}”, de ${formatMoney(entry.amount)} em ${entry.cost_date.split('-').reverse().join('/')}?`)) return
    const deleted = await mutate(() => supabase.from('financial_cost_entries').delete().eq('id', entry.id), 'Despesa excluída.')
    if (deleted && expenseDraft?.id === entry.id) setExpenseDrafts((previous) => ({ ...previous, [month]: null }))
  }

  return <div className="fw-costs" hidden={!active}>
    <div className="fw-automatic" aria-label="Custos automáticos"><strong>Calculados automaticamente</strong><span>Fabricação {formatMoney(data.rates.production)}/un.</span><span>Frete {formatMoney(data.rates.shipping)}/pedido elegível</span><span>Skale {formatMoney(data.rates.skale)}/pedido</span><span>Tráfego e taxas reais da origem</span></div>
    {message && <p className={`fw-message${message.error ? ' error' : ''}`} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
    <section className="fw-panel" aria-labelledby="fw-sellers-title">
      <div className="fw-section-heading"><div><h2 id="fw-sellers-title">1. Remuneração dos vendedores</h2><p className="fw-muted">Salário só neste mês. Comissão continua vigente até você alterar. Zero explícito é válido.</p></div><button className="fw-link" type="button" onClick={onRanking}>Ver ranking →</button></div>
      <div className="fw-seller-settings">
        {data.seller_settings.length === 0 && <p className="fw-muted">Nenhum vendedor disponível neste mês.</p>}
        {data.seller_settings.map((entry) => <div className={`fw-setting-row${entry.seller_id === sellerId ? ' selected' : ''}`} key={entry.seller_id}>
          <strong>{entry.seller_name}</strong><span>Salário: {entry.monthly_salary == null ? 'não lançado' : formatMoney(entry.monthly_salary)}</span><span>Comissão: {entry.commission_pct == null ? 'não configurada' : formatPercent(entry.commission_pct)}</span>
          <button type="button" className="fw-secondary" aria-expanded={entry.seller_id === sellerId} aria-controls="fw-seller-editor" disabled={saving} onClick={() => { onSelectSeller(entry.seller_id); setMessage(null) }}>Editar<span className="sr-only"> {entry.seller_name}</span></button>
        </div>)}
      </div>
      {setting && <form id="fw-seller-editor" className="fw-editor" onSubmit={saveSeller}>
        <h3>{setting.seller_name} · {label}</h3>
        <div className="fw-form-grid"><label htmlFor="fw-salary">Salário deste mês (R$)<input id="fw-salary" inputMode="decimal" value={draft.salary} onChange={(event) => updateDraft('salary', event.target.value)} placeholder="Ex.: 1.000,00" disabled={saving} /><small>Não repete o salário do mês anterior. Em branco preserva o valor já lançado.</small></label>
          <label htmlFor="fw-commission">Comissão vigente (%)<input id="fw-commission" inputMode="decimal" value={draft.commission} onChange={(event) => updateDraft('commission', event.target.value)} placeholder="Ex.: 8,00" disabled={saving} /><small>{setting.commission_effective_month ? `${formatPercent(setting.commission_pct)} desde ${formatMonth(setting.commission_effective_month)}. ` : 'Ainda sem percentual vigente. '}Alterar inicia nova vigência em {label}. Manter o percentual preserva o histórico.</small></label></div>
        <div className="fw-actions"><button className="fw-primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar remuneração'}</button><button className="fw-secondary" type="button" disabled={saving} onClick={() => onSelectSeller(null)}>Fechar edição</button></div>
      </form>}
    </section>
    <div className="fw-costs-bottom">
      <section className="fw-panel" aria-labelledby="fw-tax-title"><h2 id="fw-tax-title">2. Imposto do mês</h2><p className="fw-muted">{data.tax ? `Lançado: ${formatMoney(data.tax.tax_paid)}.` : 'Não lançado.'} Rateado pelos pedidos pagos/parciais; sem pagamentos, fica no custo geral.</p>
        <form onSubmit={saveTax}><label htmlFor="fw-tax">Imposto efetivamente pago (R$)<input id="fw-tax" inputMode="decimal" value={taxInput} onChange={(event) => setTaxDrafts((previous) => ({ ...previous, [month]: event.target.value }))} placeholder="0,00" disabled={saving} required /></label><div className="fw-actions"><button className="fw-primary" type="submit" disabled={saving}>Salvar imposto</button>{data.tax && <button className="fw-link fw-danger" type="button" disabled={saving} onClick={deleteTax}>Excluir lançamento</button>}</div></form>
      </section>
      <section className="fw-panel" aria-labelledby="fw-expenses-title"><div className="fw-section-heading"><div><h2 id="fw-expenses-title">3. Despesas gerais</h2><p className="fw-muted">Total: {formatMoney(data.summary.general_expenses)} · Sem rateio entre vendedores.</p></div><button className="fw-secondary" type="button" disabled={saving || Boolean(expenseDraft)} onClick={() => setExpenseDrafts((previous) => ({ ...previous, [month]: { description: '', amount: '', cost_date: monthDate } }))}>+ Adicionar despesa</button></div>
        <p className="fw-muted">Lance outras despesas do negócio. Salários já são contabilizados na remuneração acima.</p>
        {expenseDraft && <form className="fw-editor" onSubmit={saveExpense}>
          <h3>{expenseDraft.id ? 'Editar despesa' : 'Nova despesa'} · {label}</h3>
          <label htmlFor="fw-expense-description">Descrição<input id="fw-expense-description" value={expenseDraft.description} onChange={(event) => updateExpense('description', event.target.value)} maxLength={200} required disabled={saving} autoFocus /></label>
          <div className="fw-form-grid"><label htmlFor="fw-expense-amount">Valor (R$)<input id="fw-expense-amount" inputMode="decimal" value={expenseDraft.amount} onChange={(event) => updateExpense('amount', event.target.value)} required disabled={saving} /></label><label htmlFor="fw-expense-date">Data<input id="fw-expense-date" type="date" value={expenseDraft.cost_date} min={monthDate} max={`${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()}`} onChange={(event) => updateExpense('cost_date', event.target.value)} required disabled={saving} /></label></div>
          <div className="fw-actions"><button className="fw-primary" type="submit" disabled={saving}>Salvar despesa</button><button className="fw-secondary" type="button" disabled={saving} onClick={() => setExpenseDrafts((previous) => ({ ...previous, [month]: null }))}>Cancelar</button></div>
        </form>}
        <div className="fw-expense-list">{!data.expenses.length && <p className="fw-muted">Nenhuma despesa geral lançada neste mês.</p>}{data.expenses.map((entry) => <div key={entry.id} className="fw-expense-row"><div><strong>{entry.description}</strong><small>{entry.cost_date.split('-').reverse().join('/')}</small></div><strong>{formatMoney(entry.amount)}</strong><div className="fw-actions"><button type="button" className="fw-link" disabled={saving || Boolean(expenseDraft)} onClick={() => setExpenseDrafts((previous) => ({ ...previous, [month]: { ...entry, amount: String(entry.amount) } }))} aria-label={`Editar ${entry.description}`}>Editar</button><button type="button" className="fw-link fw-danger" disabled={saving} onClick={() => deleteExpense(entry)} aria-label={`Excluir ${entry.description}`}>Excluir</button></div></div>)}</div>
      </section>
    </div>
    <PendingReasons row={data.summary} />
  </div>
}
