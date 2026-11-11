import { FinancialBars, FinancialMetrics, PendingReasons } from './FinancialComponents'
import { costFields, costLabel, formatMoney } from '../lib/financialWorkspace'

export default function FinancialDashboardPage({ data, onConfigure }) {
  const summary = data.summary
  return <div className="fw-dashboard">
    <FinancialMetrics row={summary} dashboard />
    <PendingReasons row={summary} onConfigure={() => onConfigure(null)} />
    <div className="fw-dashboard-grid">
      <article className="fw-panel"><h2>Recebido × custo</h2><FinancialBars row={summary} /><p className="fw-muted">Pagamentos integrais e parciais efetivos dos pedidos criados no mês selecionado.</p></article>
      <article className="fw-panel"><h2>Composição dos custos</h2><dl className="fw-composition">
        {costFields.map(([key, label]) => <div key={key}><dt>{costLabel(summary, key, label)}</dt><dd>{formatMoney(summary[key])}</dd></div>)}
        <div><dt>Imposto não alocado</dt><dd>{formatMoney(summary.unallocated_tax)}</dd></div>
        <div><dt>Despesas gerais</dt><dd>{formatMoney(summary.general_expenses)}</dd></div>
        <div className="fw-total"><dt>{summary.total_cost == null ? 'Subtotal conhecido' : 'Total'}</dt><dd>{formatMoney(summary.total_cost ?? summary.known_cost)}</dd></div>
      </dl></article>
    </div>
    <article className="fw-panel"><h2>Reconciliação do mês</h2><p className="fw-muted">Vendedores + não atribuídos + despesas gerais + imposto não alocado. O imposto rateado já está no custo de cada linha.</p>
      <div className="fw-reconciliation" role="table" aria-label="Reconciliação financeira">
        <div className="fw-reconciliation-head" role="row"><span role="columnheader">Origem</span><span role="columnheader">Recebido conhecido</span><span role="columnheader">Custo conhecido</span><span role="columnheader">Lucro confirmado</span></div>
        {data.rows.map((row) => <div role="row" key={row.seller_id || row.row_type}><strong role="cell">{row.row_type === 'unassigned' ? 'Não atribuído' : row.seller_name}</strong><span role="cell" data-label="Recebido">{formatMoney(row.known_received_revenue)}</span><span role="cell" data-label="Custo conhecido">{formatMoney(row.known_cost)}</span><span role="cell" data-label="Lucro">{formatMoney(row.confirmed_profit)}</span></div>)}
        <div role="row"><strong role="cell">Despesas gerais</strong><span role="cell" data-label="Recebido">—</span><span role="cell" data-label="Custo">{formatMoney(summary.general_expenses)}</span><span role="cell" data-label="Resultado">{formatMoney(-Number(summary.general_expenses))}</span></div>
        <div role="row"><strong role="cell">Imposto não alocado</strong><span role="cell" data-label="Recebido">—</span><span role="cell" data-label="Custo">{formatMoney(summary.unallocated_tax)}</span><span role="cell" data-label="Resultado">{formatMoney(-Number(summary.unallocated_tax))}</span></div>
      </div>
      <p className="fw-muted">Imposto do mês: {summary.tax_recorded ? 'lançado' : 'não lançado'}. <button className="fw-link" type="button" onClick={() => onConfigure(null)}>Gerenciar custos</button></p>
    </article>
  </div>
}
