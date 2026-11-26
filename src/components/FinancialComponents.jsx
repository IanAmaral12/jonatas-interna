import { calculateBreakEvenBars } from '../lib/financialDreBars'
import { costFields, costLabel, formatCommission, formatMoney, formatPercent, hasFinancialPending } from '../lib/financialWorkspace'

const pendingLabels = {
  salary: ['vendedor sem salário lançado', 'vendedores sem salário lançado'], commission: ['vendedor sem comissão configurada', 'vendedores sem comissão configurada'],
  units: ['pedido sem quantidade de produtos', 'pedidos sem quantidade de produtos'], payment_fee: ['pedido sem taxa de pagamento', 'pedidos sem taxa de pagamento'],
  received_amount: ['pagamento sem valor recebido', 'pagamentos sem valor recebido'], external_commission: ['pedido sem comissão externa informada', 'pedidos sem comissão externa informada'],
}

export function PendingReasons({ row, onConfigure, compact = false }) {
  const entries = Object.entries(row.pending || {}).filter(([, count]) => Number(count) > 0)
  if (!entries.length) return null
  const editable = Number(row.pending.salary || 0) + Number(row.pending.commission || 0) > 0
  const source = ['units', 'payment_fee', 'received_amount', 'external_commission'].some((key) => Number(row.pending[key] || 0) > 0)
  return <div className={`fw-pending${compact ? ' compact' : ''}`}>
    {!compact && <><strong>Resultado parcial · faltam dados</strong><p>O cálculo considera os valores conhecidos e será atualizado conforme os dados forem completados.</p></>}
    <ul>{entries.map(([key, count]) => <li key={key}>{count} {pendingLabels[key]?.[Number(count) === 1 ? 0 : 1] || key}</li>)}</ul>
    {source && !compact && <p>Dados ausentes serão atualizados ao receber as informações dos pedidos e pagamentos.</p>}
    {editable && onConfigure && <button type="button" className="fw-link" onClick={onConfigure}>Configurar remuneração{row.seller_id ? ` de ${row.seller_name}` : ''}</button>}
  </div>
}

export function ResultHighlight({ row, title }) {
  const partial = hasFinancialPending(row)
  const profit = Number(row.confirmed_profit)
  const loss = row.confirmed_profit != null && profit < 0
  return <div className={`fw-result-highlight ${loss ? 'negative' : 'positive'}`}>
    {title && <small>{title}</small>}
    <span>{loss ? 'Prejuízo' : 'Lucro'}{partial ? ' parcial' : ''}</span>
    <strong>{row.confirmed_profit == null ? formatMoney(null) : formatMoney(Math.abs(profit))}</strong>
    <small>Margem {formatPercent(row.margin_pct)}</small>
  </div>
}

export function DeliveredPaid({ row }) {
  const delivered = Number(row.delivered_count || 0)
  const deliveredPaid = Number(row.delivered_paid_count || 0)
  return <dl className="fw-delivery" aria-label="Entregues e pagos">
    <div><dt>Entregues</dt><dd>{delivered}</dd></div>
    <div><dt>Pagos</dt><dd>{Number(row.paid_count || 0)}</dd></div>
    <div><dt>Entregues já pagos</dt><dd>{deliveredPaid}{delivered > 0 && <small> · {formatPercent(Math.round(deliveredPaid / delivered * 100))}</small>}</dd></div>
    <div><dt>Entregues sem pagamento</dt><dd className={delivered > deliveredPaid ? 'fw-profit-negative' : undefined}>{delivered - deliveredPaid}</dd></div>
  </dl>
}

export function FinancialBars({ row }) {
  const partial = hasFinancialPending(row)
  const cost = Number(row.total_cost ?? row.known_cost) || 0
  const revenue = Number(row.confirmed_revenue ?? row.known_received_revenue) || 0
  const scheduled = Number(row.scheduled_revenue) || 0
  const bars = calculateBreakEvenBars(cost, revenue)
  // One scale for the three values: scheduled revenue, unless costs or receipts exceed it.
  const scale = Math.max(scheduled, cost, revenue, 1)
  const position = (value) => `${Math.min(value / scale * 100, 100)}%`
  const legend = [
    [partial ? 'Recebido conhecido' : 'Recebido confirmado', revenue, 'received'],
    [partial ? 'Custo conhecido' : 'Custo total', cost, 'cost'],
    ['Faturamento agendado', scheduled, 'scheduled'],
  ]
  return <div className="fw-bars">
    <div className="fw-single-bar" role="img" aria-label={legend.map(([label, value]) => `${label}: ${formatMoney(value)}`).join('; ')}>
      <span className={`received${revenue >= cost ? ' covered' : ''}`} style={{ width: position(revenue) }} />
      <i className="fw-cost-marker" style={{ left: position(cost) }} />
    </div>
    <dl className="fw-bar-legend">{legend.map(([label, value, className]) => <div key={className}><dt><b className={className} aria-hidden="true" />{label}</dt><dd>{formatMoney(value)}</dd></div>)}</dl>
    <p className={`fw-breakeven ${bars.remaining > 0 ? 'negative' : 'positive'}`}>
      {cost > 0 && <span>{formatPercent(revenue / cost * 100)} do custo coberto · </span>}
      {bars.remaining > 0 ? `Faltam ${formatMoney(bars.remaining)} para se pagar`
        : bars.surplus > 0 ? `Excedente de ${formatMoney(bars.surplus)}` : 'Custo coberto'}
      {partial && <span> · considerando os valores conhecidos</span>}
    </p>
  </div>
}

export function CostDetails({ row }) {
  return <details className="fw-details"><summary>Composição dos custos</summary><dl>
    {costFields.map(([key, label]) => <div key={key}><dt>{costLabel(row, key, label)}{key === 'commission_cost' ? ` (${formatCommission(row.commission_type, row.commission_pct)})` : ''}</dt><dd>{formatMoney(row[key])}</dd></div>)}
    <div className="fw-total"><dt>{hasFinancialPending(row) ? 'Total de custos conhecidos' : 'Custo total'}</dt><dd>{formatMoney(row.total_cost ?? row.known_cost)}</dd></div>
  </dl></details>
}

export function FinancialMetrics({ row, dashboard = false }) {
  const partial = hasFinancialPending(row)
  const profitLabel = partial ? 'Lucro parcial' : 'Lucro confirmado'
  const result = [[profitLabel, formatMoney(row.confirmed_profit)], [partial ? 'Margem parcial' : 'Margem', formatPercent(row.margin_pct)]]
  const metrics = dashboard ? [
      ['Receita agendada', formatMoney(row.scheduled_revenue)],
      [partial ? 'Recebido conhecido' : 'Recebido confirmado', formatMoney(row.known_received_revenue)],
      [partial ? 'Custos conhecidos' : 'Custo total', formatMoney(row.total_cost ?? row.known_cost)],
      ...result,
    ] : [...result, ['Receita agendada', formatMoney(row.scheduled_revenue)]]
  return <div className={`fw-metrics${dashboard ? ' fw-dashboard-metrics' : ''}`}>
    {metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong className={label === profitLabel && row.confirmed_profit != null ? Number(row.confirmed_profit) < 0 ? 'fw-profit-negative' : 'fw-profit-positive' : undefined}>{value}</strong></div>)}
  </div>
}
