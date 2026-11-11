import { hasFinancialPending, sortSellerRanking } from '../lib/financialWorkspace'
import { CostDetails, FinancialBars, FinancialMetrics, PendingReasons } from './FinancialComponents'

export default function SellerFinancialRankingPage({ data, onConfigure }) {
  const sorted = sortSellerRanking(data.rows)
  const confirmed = sorted.filter((row) => row.confirmed_profit != null && !hasFinancialPending(row))
  const pending = sorted.filter((row) => row.confirmed_profit == null || hasFinancialPending(row))
  const group = (rows, complete) => rows.map((row, index) => <article className="fw-panel fw-seller-card" key={row.seller_id}>
    <div className="fw-section-heading"><h3>{complete && <span className="fw-position">{index + 1}º</span>}{row.seller_name}</h3><span className={`fw-badge${complete ? Number(row.confirmed_profit) >= 0 ? ' complete' : ' evolving' : ''}`}>{complete ? Number(row.confirmed_profit) > 0 ? 'Se pagou' : Number(row.confirmed_profit) === 0 ? 'No equilíbrio' : 'Em evolução' : 'Sem posição · pendente'}</span></div>
    <FinancialMetrics row={row} />
    <FinancialBars row={row} />
    <PendingReasons row={row} compact onConfigure={() => onConfigure(row.seller_id)} />
    <CostDetails row={row} />
  </article>)
  return <div className="fw-ranking">
    <p className="fw-muted fw-ranking-order">Ordenado por lucro confirmado.</p>
    {!sorted.length && <div className="fw-panel fw-empty">Nenhum vendedor com atividade ou salário lançado neste mês.</div>}
    {group(confirmed, true)}
    {pending.length > 0 && <section aria-labelledby="fw-pending-ranking"><h2 id="fw-pending-ranking">Aguardando dados <span className="fw-count">{pending.length}</span></h2><p className="fw-muted">Sem posição até completar os dados. Configure a remuneração quando necessário; taxas e recebimentos ausentes dependem dos dados dos pedidos.</p>{group(pending, false)}</section>}
  </div>
}
