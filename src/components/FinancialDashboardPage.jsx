import { FinancialMetrics, PendingReasons } from './FinancialComponents'
import { costFields, costLabel, costsByCategory, formatMoney, formatPercent, hasFinancialPending } from '../lib/financialWorkspace'

export default function FinancialDashboardPage({ data, onConfigure }) {
  const summary = data.summary
  const categories = costsByCategory(summary, data.expenses, data.recurring_costs)
  const largest = categories[0]?.amount || 1
  const totalCost = Number(summary.total_cost ?? summary.known_cost) || 0
  return <div className="fw-dashboard">
    <FinancialMetrics row={summary} dashboard />
    <PendingReasons row={summary} onConfigure={() => onConfigure(null)} />
    <article className="fw-panel" aria-labelledby="fw-categories-title"><h2 id="fw-categories-title">Custos por setor</h2>
      {!categories.length && <p className="fw-muted">Nenhum custo registrado neste mês.</p>}
      <div className="fw-bars">{categories.map((category) => <div key={category.key}>
        <div className="fw-bar-label"><span>{category.label}</span><strong>{formatMoney(category.amount)}{totalCost > 0 && <small> · {formatPercent(category.amount / totalCost * 100)}</small>}</strong></div>
        <div className="fw-bar-track" role="meter" aria-label={category.label} aria-valuemin={0} aria-valuemax={largest} aria-valuenow={category.amount}><span className="cost" style={{ width: `${category.amount / largest * 100}%` }} /></div>
      </div>)}</div>
    </article>
      <article className="fw-panel"><h2>Composição dos custos</h2><dl className="fw-composition">
        {costFields.map(([key, label]) => <div key={key}><dt>{costLabel(summary, key, label)}</dt><dd>{formatMoney(summary[key])}</dd></div>)}
        <div><dt>Imposto não alocado</dt><dd>{formatMoney(summary.unallocated_tax)}</dd></div>
        <div><dt>Despesas gerais</dt><dd>{formatMoney(summary.general_expenses)}</dd></div>
        <div className="fw-total"><dt>{hasFinancialPending(summary) ? 'Total conhecido' : 'Total'}</dt><dd>{formatMoney(summary.total_cost ?? summary.known_cost)}</dd></div>
      </dl></article>
    <details className="fw-panel fw-audit"><summary>Conferir resultado por origem</summary><p className="fw-muted">Resultado dos vendedores e despesas gerais. O imposto rateado já está incluído nos custos.</p>
      <div className="fw-reconciliation" role="table" aria-label="Reconciliação financeira">
        <div className="fw-reconciliation-head" role="row"><span role="columnheader">Origem</span><span role="columnheader">Recebido conhecido</span><span role="columnheader">Custo conhecido</span><span role="columnheader">Resultado calculado</span></div>
        {data.rows.map((row) => <div role="row" key={row.seller_id || row.row_type}><strong role="cell">{row.row_type === 'unassigned' ? 'Não atribuído' : row.seller_name}</strong><span role="cell" data-label="Recebido">{formatMoney(row.known_received_revenue)}</span><span role="cell" data-label="Custo conhecido">{formatMoney(row.known_cost)}</span><span role="cell" data-label="Lucro">{formatMoney(row.confirmed_profit)}</span></div>)}
        <div role="row"><strong role="cell">Despesas gerais</strong><span role="cell" data-label="Recebido">—</span><span role="cell" data-label="Custo">{formatMoney(summary.general_expenses)}</span><span role="cell" data-label="Resultado">{formatMoney(-Number(summary.general_expenses) || 0)}</span></div>
        <div role="row"><strong role="cell">Imposto não alocado</strong><span role="cell" data-label="Recebido">—</span><span role="cell" data-label="Custo">{formatMoney(summary.unallocated_tax)}</span><span role="cell" data-label="Resultado">{formatMoney(-Number(summary.unallocated_tax) || 0)}</span></div>
      </div>
      <p className="fw-muted">Imposto do mês: {summary.tax_recorded ? 'lançado' : 'não lançado'}. Resultados com pendências consideram somente os valores conhecidos.</p>
    </details>
  </div>
}
