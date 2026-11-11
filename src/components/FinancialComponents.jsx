import { calculateBreakEvenBars } from '../lib/financialDreBars'
import { costFields, costLabel, formatMoney, formatPercent } from '../lib/financialWorkspace'

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
    {!compact && <strong>Faltam dados para fechar o resultado</strong>}
    <ul>{entries.map(([key, count]) => <li key={key}>{count} {pendingLabels[key]?.[Number(count) === 1 ? 0 : 1] || key}</li>)}</ul>
    {source && !compact && <p>Dados ausentes serão atualizados ao receber as informações dos pedidos e pagamentos.</p>}
    {editable && onConfigure && <button type="button" className="fw-link" onClick={onConfigure}>Configurar remuneração{row.seller_id ? ` de ${row.seller_name}` : ''}</button>}
  </div>
}

export function FinancialBars({ row }) {
  const complete = row.total_cost != null && row.confirmed_revenue != null
  const cost = Number(complete ? row.total_cost : row.known_cost)
  const revenue = Number(complete ? row.confirmed_revenue : row.known_received_revenue)
  const bars = calculateBreakEvenBars(cost, revenue)
  const scale = Math.max(cost, revenue, 1)
  return <div className="fw-bars" aria-label="Comparação de custo e recebimento na mesma escala">
    {[
      [complete ? 'Custo total' : 'Custo conhecido', cost, bars.costPercent, 'cost'],
      [complete ? 'Recebido confirmado' : 'Recebido conhecido', revenue, bars.paidPercent, 'received'],
    ].map(([label, value, width, className]) => <div key={className}>
      <div className="fw-bar-label"><span>{label}</span><strong>{formatMoney(value)}</strong></div>
      <div className="fw-bar-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={scale} aria-valuenow={value}>
        <span className={className} style={{ width: `${width || 0}%` }} />
      </div>
    </div>)}
    {complete ? <p className={`fw-breakeven ${bars.remaining > 0 ? 'negative' : 'positive'}`}>
      {cost > 0 && <span>{formatPercent(revenue / cost * 100)} do custo coberto · </span>}
      {bars.remaining > 0 ? `Faltam ${formatMoney(bars.remaining)} para se pagar`
        : bars.surplus > 0 ? `Excedente de ${formatMoney(bars.surplus)}` : 'Custo coberto'}
    </p> : null}
  </div>
}

export function CostDetails({ row }) {
  return <details className="fw-details"><summary>Composição dos custos</summary><dl>
    {costFields.map(([key, label]) => <div key={key}><dt>{costLabel(row, key, label)}{key === 'commission_cost' ? ` (${formatPercent(row.commission_pct)})` : ''}</dt><dd>{formatMoney(row[key])}</dd></div>)}
    <div className="fw-total"><dt>{row.total_cost == null ? 'Subtotal de custos conhecidos' : 'Custo total'}</dt><dd>{formatMoney(row.total_cost ?? row.known_cost)}</dd></div>
  </dl></details>
}

export function FinancialMetrics({ row, dashboard = false }) {
  const result = [['Lucro confirmado', formatMoney(row.confirmed_profit)], ['Margem', formatPercent(row.margin_pct)]]
  const metrics = dashboard ? [
      ['Receita agendada', formatMoney(row.scheduled_revenue)],
      [row.confirmed_revenue == null ? 'Recebido conhecido' : 'Recebido confirmado', formatMoney(row.known_received_revenue)],
      [row.total_cost == null ? 'Custos conhecidos · subtotal' : 'Custo total', formatMoney(row.total_cost ?? row.known_cost)],
      ...result,
    ] : [...result, ['Receita agendada', formatMoney(row.scheduled_revenue)]]
  return <div className={`fw-metrics${dashboard ? ' fw-dashboard-metrics' : ''}`}>
    {metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong className={label === 'Lucro confirmado' && row.confirmed_profit != null ? Number(row.confirmed_profit) < 0 ? 'fw-profit-negative' : 'fw-profit-positive' : undefined}>{value}</strong></div>)}
  </div>
}
