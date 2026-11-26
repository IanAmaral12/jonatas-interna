import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeCashFlow } from '../src/lib/cashFlow.js'

const data = {
  payments: [
    { order_id: 'a', paid_date: '2026-11-21', seller_id: 'ana', seller_name: 'Ana', amount: '447.00' },
    { order_id: 'b', paid_date: '2026-11-21', seller_id: null, seller_name: 'Não atribuído', amount: 200 },
    { order_id: 'c', paid_date: '2026-11-22', seller_id: 'ana', seller_name: 'Ana', amount: 100.1 },
  ],
  generated_costs: [
    { seller_id: 'ana', seller_name: 'Ana', freight_orders: 2, units: 3, missing_units: 1, shipping_cost: 60, production_cost: '20.70' },
    { seller_id: null, seller_name: 'Não atribuído', freight_orders: 1, units: 1, missing_units: 0, shipping_cost: 30, production_cost: 6.9 },
  ],
}

test('groups payments by most recent day and totals generated costs', () => {
  const result = summarizeCashFlow(data, 'all')
  assert.equal(result.received, 747.1)
  assert.deepEqual(result.days.map(d => [d.date, d.total, d.payments.length]), [['2026-11-22', 100.1, 1], ['2026-11-21', 647, 2]])
  assert.deepEqual(result.costs, { freight_orders: 3, units: 4, missing_units: 1, shipping: 90, production: 27.6, total: 117.6 })
  assert.deepEqual(result.sellers, [['ana', 'Ana'], ['unassigned', 'Não atribuído']])
})

test('filters payments and costs by seller, including unassigned orders', () => {
  assert.equal(summarizeCashFlow(data, 'ana').received, 547.1)
  const unassigned = summarizeCashFlow(data, 'unassigned')
  assert.equal(unassigned.received, 200)
  assert.equal(unassigned.costs.total, 36.9)
  assert.deepEqual(summarizeCashFlow(null, 'all').days, [])
})
