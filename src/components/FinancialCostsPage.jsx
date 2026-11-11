import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { parseFinancialDecimal } from '../lib/financialDreSettings'
import { formatMoney, formatMonth, formatPercent, sellerSettingChanges } from '../lib/financialWorkspace'

export default function FinancialCostsPage({ data, month, sellerId, onSelectSeller, onRefresh, active }) {
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
  const feedback = (section) => message?.month === month && message.section === section && <p className={`fw-message${message.error ? ' error' : ''}`} role={message.error ? 'alert' : 'status'}>{message.text}</p>
  function closeExpenseEditor() {
    const target = expenseDraft?.id ? `fw-edit-expense-${expenseDraft.id}` : 'fw-add-expense'
    setExpenseDrafts((previous) => ({ ...previous, [month]: null }))
    window.requestAnimationFrame(() => document.getElementById(target)?.focus())
  }

  async function mutate(action, success, section) {
    setSaving(true)
    setMessage(null)
    try {
      const result = await action()
      if (result.error) throw result.error
      setMessage({ text: success, error: false, section, month })
      onRefresh()
      return true
    } catch {
      setMessage({ text: 'Não foi possível salvar. Seus dados foram preservados; tente novamente.', error: true, section, month })
      return false
    } finally {
      setSaving(false)
    }
  }

  async function saveSeller(event) {
    event.preventDefault()
    let changes
    try { changes = sellerSettingChanges(setting, draft) }
    catch (error) { setMessage({ text: error.message, error: true, section: 'seller', month }); return }
    if (!Object.keys(changes).length) { setMessage({ text: 'Nenhuma alteração para salvar.', error: false, section: 'seller', month }); return }
    const exists = savedSellerKeys.has(key) || setting.monthly_salary != null || setting.month_commission_pct != null
    const saved = await mutate(() => exists
      ? supabase.from('seller_financial_settings').update(changes).eq('seller_id', sellerId).eq('effective_month', monthDate)
      : supabase.from('seller_financial_settings').insert({ seller_id: sellerId, effective_month: monthDate, ...changes }),
    `Remuneração de ${setting.seller_name} salva para ${label}.`, 'seller')
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
    if (amount === null) { setMessage({ text: 'Informe o imposto pago com até duas casas decimais. Zero é válido.', error: true, section: 'tax', month }); return }
    await mutate(() => supabase.from('financial_monthly_taxes').upsert({ month_start: monthDate, tax_paid: amount }, { onConflict: 'month_start' }), 'Imposto do mês salvo.', 'tax')
  }

  async function deleteTax() {
    if (!window.confirm(`Excluir permanentemente o imposto de ${label}, no valor de ${formatMoney(data.tax.tax_paid)}? O mês voltará ao estado “Não lançado”.`)) return
    const deleted = await mutate(() => supabase.from('financial_monthly_taxes').delete().eq('month_start', monthDate), 'Lançamento de imposto excluído.', 'tax')
    if (deleted) setTaxDrafts((previous) => ({ ...previous, [month]: '' }))
  }

  async function saveExpense(event) {
    event.preventDefault()
    const amount = parseFinancialDecimal(expenseDraft.amount, 999999999999.99)
    const description = expenseDraft.description.trim()
    if (amount == null || amount <= 0 || !description || description.length > 200 || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDraft.cost_date) || !expenseDraft.cost_date.startsWith(`${month}-`)) {
      setMessage({ text: 'Confira a descrição, o valor maior que zero e a data no mês selecionado.', error: true, section: 'expense', month }); return
    }
    const values = { description, amount, cost_date: expenseDraft.cost_date }
    const saved = await mutate(() => expenseDraft.id
      ? supabase.from('financial_cost_entries').update(values).eq('id', expenseDraft.id)
      : supabase.from('financial_cost_entries').insert(values), 'Despesa salva.', 'expense')
    if (saved) closeExpenseEditor()
  }

  async function deleteExpense(entry) {
    if (!window.confirm(`Excluir permanentemente a despesa “${entry.description}”, de ${formatMoney(entry.amount)} em ${entry.cost_date.split('-').reverse().join('/')}?`)) return
    const deleted = await mutate(() => supabase.from('financial_cost_entries').delete().eq('id', entry.id), 'Despesa excluída.', 'expense')
    if (deleted && expenseDraft?.id === entry.id) setExpenseDrafts((previous) => ({ ...previous, [month]: null }))
  }

  return <div className="fw-costs" hidden={!active}>
    <details className="fw-automatic"><summary>Custos calculados automaticamente</summary><div><span>Fabricação {formatMoney(data.rates.production)}/un.</span><span>Frete {formatMoney(data.rates.shipping)}/pedido elegível</span><span>Skale {formatMoney(data.rates.skale)}/pedido</span><span>Tráfego e taxas integrados automaticamente</span></div></details>
    <section className="fw-panel" aria-labelledby="fw-sellers-title">
      <div className="fw-section-heading"><div><h2 id="fw-sellers-title">Remuneração dos vendedores</h2><p className="fw-muted">Salário lançado por mês; comissão mantém a última vigência.</p></div></div>
      <div className="fw-seller-settings">
        {data.seller_settings.length === 0 && <p className="fw-muted">Nenhum vendedor disponível neste mês.</p>}
        {data.seller_settings.map((entry) => <div className="fw-setting-group" key={entry.seller_id}><div className={`fw-setting-row${entry.seller_id === sellerId ? ' selected' : ''}`}>
          <strong>{entry.seller_name}</strong><span>Salário: {entry.monthly_salary == null ? 'não lançado' : formatMoney(entry.monthly_salary)}</span><span>Comissão: {entry.commission_pct == null ? 'não configurada' : formatPercent(entry.commission_pct)}</span>
          <button id={`fw-edit-${entry.seller_id}`} type="button" className="fw-secondary" aria-expanded={entry.seller_id === sellerId} aria-controls={entry.seller_id === sellerId ? 'fw-seller-editor' : undefined} disabled={saving} onClick={() => { onSelectSeller(entry.seller_id); setMessage(null) }}>Editar<span className="sr-only"> {entry.seller_name}</span></button>
        </div>
      {entry.seller_id === sellerId && setting && <form id="fw-seller-editor" className="fw-editor" onSubmit={saveSeller}>
        <h3>{setting.seller_name} · {label}</h3>
        <div className="fw-form-grid"><label htmlFor="fw-salary">Salário deste mês (R$)<input id="fw-salary" inputMode="decimal" value={draft.salary} onChange={(event) => updateDraft('salary', event.target.value)} placeholder="Ex.: 1.000,00" disabled={saving} /><small>Em branco mantém o valor salvo. Use 0 para um mês sem salário.</small></label>
          <label htmlFor="fw-commission">Comissão vigente (%)<input id="fw-commission" inputMode="decimal" value={draft.commission} onChange={(event) => updateDraft('commission', event.target.value)} placeholder="Ex.: 8,00" disabled={saving} /><small>{setting.commission_effective_month ? `Vigente desde ${formatMonth(setting.commission_effective_month)}. ` : 'Ainda sem percentual vigente. '}Alterações valem a partir de {label}.</small></label></div>
        {feedback('seller')}
        <div className="fw-actions"><button className="fw-primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar remuneração'}</button><button className="fw-secondary" type="button" disabled={saving} onClick={() => { document.getElementById(`fw-edit-${sellerId}`)?.focus(); onSelectSeller(null) }}>Fechar edição</button></div>
      </form>}</div>)}
      </div>
    </section>
    <div className="fw-costs-bottom">
      <section className="fw-panel" aria-labelledby="fw-tax-title"><h2 id="fw-tax-title">Imposto do mês</h2><p className="fw-muted">{data.tax ? `Lançado: ${formatMoney(data.tax.tax_paid)}.` : 'Não lançado.'} Rateado entre pedidos pagos e parciais.</p>
        <form onSubmit={saveTax}><label htmlFor="fw-tax">Imposto efetivamente pago (R$)<input id="fw-tax" inputMode="decimal" value={taxInput} onChange={(event) => setTaxDrafts((previous) => ({ ...previous, [month]: event.target.value }))} placeholder="0,00" disabled={saving} required /></label>{feedback('tax')}<div className="fw-actions"><button className="fw-primary" type="submit" disabled={saving}>Salvar imposto</button>{data.tax && <button className="fw-link fw-danger" type="button" disabled={saving} onClick={deleteTax}>Excluir lançamento</button>}</div></form>
      </section>
      <section className="fw-panel" aria-labelledby="fw-expenses-title"><div className="fw-section-heading"><div><h2 id="fw-expenses-title">Despesas gerais</h2><p className="fw-muted">Total do mês: {formatMoney(data.summary.general_expenses)} · Só no consolidado.</p></div><button id="fw-add-expense" className="fw-secondary" type="button" disabled={saving || Boolean(expenseDraft)} onClick={() => { setMessage(null); setExpenseDrafts((previous) => ({ ...previous, [month]: { description: '', amount: '', cost_date: monthDate } })) }}>+ Adicionar despesa</button></div>
        <p className="fw-muted">Lance outras despesas do negócio. Salários já são contabilizados na remuneração acima.</p>
        {!expenseDraft && feedback('expense')}
        {expenseDraft && <form className="fw-editor" onSubmit={saveExpense}>
          <h3>{expenseDraft.id ? 'Editar despesa' : 'Nova despesa'} · {label}</h3>
          <label htmlFor="fw-expense-description">Descrição<input id="fw-expense-description" value={expenseDraft.description} onChange={(event) => updateExpense('description', event.target.value)} maxLength={200} required disabled={saving} autoFocus /></label>
          <div className="fw-form-grid"><label htmlFor="fw-expense-amount">Valor (R$)<input id="fw-expense-amount" inputMode="decimal" value={expenseDraft.amount} onChange={(event) => updateExpense('amount', event.target.value)} required disabled={saving} /></label><label htmlFor="fw-expense-date">Data<input id="fw-expense-date" type="date" value={expenseDraft.cost_date} min={monthDate} max={`${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()}`} onChange={(event) => updateExpense('cost_date', event.target.value)} required disabled={saving} /></label></div>
          {feedback('expense')}
          <div className="fw-actions"><button className="fw-primary" type="submit" disabled={saving}>Salvar despesa</button><button className="fw-secondary" type="button" disabled={saving} onClick={() => { setMessage(null); closeExpenseEditor() }}>Cancelar</button></div>
        </form>}
        <div className="fw-expense-list">{!data.expenses.length && <p className="fw-muted">Nenhuma despesa geral lançada neste mês.</p>}{data.expenses.map((entry) => <div key={entry.id} className="fw-expense-row"><div><strong>{entry.description}</strong><small>{entry.cost_date.split('-').reverse().join('/')}</small></div><strong>{formatMoney(entry.amount)}</strong><div className="fw-actions"><button id={`fw-edit-expense-${entry.id}`} type="button" className="fw-link" disabled={saving || Boolean(expenseDraft)} onClick={() => { setMessage(null); setExpenseDrafts((previous) => ({ ...previous, [month]: { ...entry, amount: String(entry.amount) } })) }} aria-label={`Editar ${entry.description}`}>Editar</button><button type="button" className="fw-link fw-danger" disabled={saving} onClick={() => deleteExpense(entry)} aria-label={`Excluir ${entry.description}`}>Excluir</button></div></div>)}</div>
      </section>
    </div>
  </div>
}
