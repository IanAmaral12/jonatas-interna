import { hasFinancialPending, sortSellerRanking } from '../lib/financialWorkspace'
import { CostDetails, DeliveredPaid, FinancialBars, PendingReasons, ResultHighlight } from './FinancialComponents'

export default function SellerFinancialRankingPage({ data, onConfigure }) {
  const sorted = sortSellerRanking(data.rows)
  return <div className="fw-ranking">
    {data.summary && <article className="fw-panel fw-seller-card fw-global-card" aria-labelledby="fw-global-title">
      <div className="fw-section-heading"><h3 id="fw-global-title">Resultado global</h3><span className="fw-muted">Todos os vendedores, despesas gerais e impostos</span></div>
      <div className="fw-seller-result"><ResultHighlight row={data.summary} /><FinancialBars row={data.summary} /></div>
      <DeliveredPaid row={data.summary} />
    </article>}
    <p className="fw-muted fw-ranking-order">Ordenado pelo lucro calculado. Resultados parciais consideram somente os valores conhecidos.</p>
    {!sorted.length && <div className="fw-panel fw-empty">Nenhum vendedor com atividade ou salário lançado neste mês.</div>}
    {sorted.map((row, index) => <article className="fw-panel fw-seller-card" key={row.seller_id}>
      <div className="fw-section-heading"><h3><span className="fw-position">{index + 1}º</span>{row.seller_name}</h3><span className={`fw-badge${hasFinancialPending(row) ? '' : Number(row.confirmed_profit) >= 0 ? ' complete' : ' evolving'}`}>{hasFinancialPending(row) ? 'Resultado parcial' : Number(row.confirmed_profit) > 0 ? 'Se pagou' : Number(row.confirmed_profit) === 0 ? 'No equilíbrio' : 'Em evolução'}</span></div>
      <div className="fw-seller-result"><ResultHighlight row={row} /><FinancialBars row={row} /></div>
      <DeliveredPaid row={row} />
      <PendingReasons row={row} compact onConfigure={() => onConfigure(row.seller_id)} />
      <CostDetails row={row} />
    </article>)}
  </div>
}
