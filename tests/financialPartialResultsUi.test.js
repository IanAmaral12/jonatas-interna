import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('financial screens show partial results and keep missing-data alerts without blocking ranking', async (t) => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, optimizeDeps: { noDiscovery: true } })
  try {
    const components = await server.ssrLoadModule('/src/components/FinancialComponents.jsx')
    const { default: Ranking } = await server.ssrLoadModule('/src/components/SellerFinancialRankingPage.jsx')
    const row = { row_type: 'seller', seller_id: 'partial', seller_name: 'Ana', total_cost: 120, known_cost: 120,
      confirmed_revenue: 80, known_received_revenue: 80, confirmed_profit: -40, margin_pct: -50,
      scheduled_revenue: 200, pending: { salary: 1, payment_fee: 1, received_amount: 1 } }
    const render = (component, props) => renderToStaticMarkup(createElement(component, props))
    await t.test('metrics and alerts explicitly identify a calculated partial result', () => {
      const html = render(components.FinancialMetrics, { row, dashboard: true })
      assert.match(html, /Lucro parcial/)
      assert.match(html, /Margem parcial/)
      assert.match(html, /40,00/)
      assert.doesNotMatch(html, /Pendente/)
      const alerts = render(components.PendingReasons, { row })
      assert.match(alerts, /Resultado parcial/)
      assert.match(alerts, /sem salário lançado/)
      assert.match(alerts, /sem taxa de pagamento/)
      assert.match(alerts, /sem valor recebido/)
    })
    await t.test('breakeven remains visible and explains that it uses known values', () => {
      const html = render(components.FinancialBars, { row })
      assert.match(html, /Custo conhecido/)
      assert.match(html, /Recebido conhecido/)
      assert.match(html, /Faltam .*40,00 para se pagar/)
      assert.match(html, /valores conhecidos/)
    })
    await t.test('incomplete sellers retain their position among all sellers', () => {
      const html = render(Ranking, { data: { rows: [row, { ...row, seller_id: 'complete', seller_name: 'Bruno', confirmed_profit: -50, pending: {} }] } })
      assert.match(html, /1º/)
      assert.ok(html.indexOf('Ana') < html.indexOf('Bruno'))
      assert.match(html, /Resultado parcial/)
      assert.doesNotMatch(html, /Sem posição|Aguardando dados/)
    })
    await t.test('complete results keep their confirmed label', () => {
      const html = render(components.FinancialMetrics, { row: { ...row, pending: {} } })
      assert.match(html, /Lucro confirmado/)
      assert.doesNotMatch(html, /Lucro parcial/)
    })
  } finally {
    await server.close()
  }
})
