import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('financial dashboard, costs and cash tab render categories, commission types and recurring costs', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, optimizeDeps: { noDiscovery: true } })
  try {
    const load = async (path) => (await server.ssrLoadModule(path)).default
    const summary = { row_type: 'summary', total_cost: 1000, known_cost: 1000, traffic_cost: 600, shipping_cost: 300,
      general_expenses: 100, unallocated_tax: 0, confirmed_profit: 0, pending: {} }
    const data = {
      summary, rows: [], tax: null, rates: { production: 6.9, shipping: 30, skale: 0.5 },
      seller_settings: [{ seller_id: 's', seller_name: 'Ana', monthly_salary: 1000, commission_pct: 15, commission_type: 'fixed_per_shipped' }],
      expenses: [{ id: 'e', description: 'Agência', amount: 40, cost_date: '2026-11-03', category: 'marketing' }],
      recurring_costs: [{ id: 'r', description: 'CRM', amount: 60, category: 'ferramentas', start_month: '2026-11-01', end_month: null }],
    }
    const dashboard = renderToStaticMarkup(createElement(await load('/src/components/FinancialDashboardPage.jsx'), { data, onConfigure() {} }))
    assert.match(dashboard, /Custos por setor/)
    assert.match(dashboard, /Marketing[\s\S]*Logística[\s\S]*Ferramentas e assinaturas/)
    const costs = renderToStaticMarkup(createElement(await load('/src/components/FinancialCostsPage.jsx'),
      { data, month: '2026-11', sellerId: 's', onSelectSeller() {}, onRefresh() {}, active: true }))
    assert.match(costs, /por pedido enviado/)
    assert.match(costs, /Tipo de comissão/)
    assert.match(costs, /Custos recorrentes[\s\S]*CRM[\s\S]*Ferramentas e assinaturas/)
    assert.match(costs, /Agência[\s\S]*Marketing/)
    const workspace = renderToStaticMarkup(createElement(await load('/src/components/FinancialWorkspace.jsx'),
      { view: 'cash', onViewChange() {}, cashFlow: createElement('p', null, 'cash-flow-slot') }))
    assert.match(workspace, /<h1 id="fw-title">Fluxo de caixa<\/h1>/)
    assert.match(workspace, /cash-flow-slot/)
    assert.doesNotMatch(workspace, /Mês de referência/)
    const seller = { row_type: 'seller', seller_id: 's', seller_name: 'Ana', scheduled_revenue: 1000, confirmed_revenue: 300,
      known_received_revenue: 300, total_cost: 500, known_cost: 500, confirmed_profit: -200, margin_pct: -66.67,
      delivered_count: 8, paid_count: 5, delivered_paid_count: 4, pending: {} }
    const ranking = renderToStaticMarkup(createElement(await load('/src/components/SellerFinancialRankingPage.jsx'),
      { data: { rows: [seller], summary: { ...seller, row_type: 'summary', seller_name: 'Consolidado', confirmed_profit: 150 } }, onConfigure() {} }))
    assert.match(ranking, /Resultado global[\s\S]*Lucro[\s\S]*150,00/)
    assert.match(ranking, /Prejuízo[\s\S]*200,00/)
    assert.match(ranking, /Faturamento agendado/)
    assert.match(ranking, /fw-single-bar/)
    assert.match(ranking, /Entregues[\s\S]*8[\s\S]*Pagos[\s\S]*5[\s\S]*Entregues já pagos[\s\S]*4[\s\S]*50%/)
  } finally { await server.close() }
})
