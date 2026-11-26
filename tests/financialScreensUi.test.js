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
  } finally { await server.close() }
})
