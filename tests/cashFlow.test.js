import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeCashFlow } from '../src/lib/cashFlow.js'

const data = {
  payments: [
    { order_id: 'a', paid_date: '2026-11-21', seller_id: 'ana', seller_name: 'Ana', amount: '447.00' },
    { order_id: 'b', paid_date: '2026-11-21', seller_id: null, seller_name: 'Não atribuído', amount: 200 },
    { order_id: 'c', paid_date: '2026-11-20', seller_id: 'ana', seller_name: 'Ana', amount: 100.1 },
  ],
  lines: [
    { day: '2026-11-20', direction: 'in', source: 'payment', seller_id: 'ana', amount: '100.10' },
    { day: '2026-11-20', direction: 'out', source: 'shipping', seller_id: 'ana', amount: 60, quantity: 2 },
    { day: '2026-11-20', direction: 'out', source: 'production', seller_id: 'ana', amount: '20.70', quantity: 3 },
    { day: '2026-11-20', direction: 'out', source: 'recurring', seller_id: null, category: 'estrutura', amount: 10 },
    { day: '2026-11-21', direction: 'in', source: 'payment', seller_id: 'ana', amount: 447 },
    { day: '2026-11-21', direction: 'in', source: 'payment', seller_id: null, amount: 200 },
    { day: '2026-11-21', direction: 'out', source: 'shipping', seller_id: null, amount: 30, quantity: 1 },
    { day: '2026-11-21', direction: 'out', source: 'tax', seller_id: 'ana', amount: 8 },
  ],
  sellers: [{ seller_id: 'ana', name: 'Ana' }],
}
const manual = [
  { day: '2026-11-21', entry_type: 'entrada', amount: 50 },
  { day: '2026-11-22', entry_type: 'saida', amount: 25.5 },
]

test('builds a daily ledger with automatic costs, manual entries and running balance', () => {
  const result = summarizeCashFlow(data, 'all', manual)
  assert.deepEqual(result.ledger.map(d => [d.date, d.inflow, d.outflow, d.net, d.cumulative]), [
    ['2026-11-22', 0, 25.5, -25.5, 642.9], ['2026-11-21', 697, 38, 659, 668.4], ['2026-11-20', 100.1, 90.7, 9.4, 9.4],
  ])
  assert.deepEqual(result.ledger[2].items.map(i => [i.label, i.amount, i.quantity]), [
    ['Pagamentos recebidos', 100.1, null], ['Frete', 60, 2], ['Fabricação (potes)', 20.7, 3], ['Custos recorrentes', 10, null],
  ])
  assert.deepEqual(result.totals, { received: 747.1, manualIn: 50, automaticOut: 128.7, manualOut: 25.5, balance: 642.9 })
  assert.deepEqual(result.outflows.map(o => [o.source, o.amount, o.quantity]), [
    ['shipping', 90, 3], ['manual_out', 25.5, null], ['production', 20.7, 3], ['recurring', 10, null], ['tax', 8, null],
  ])
  assert.deepEqual(result.days.map(d => [d.date, d.total, d.payments.length]), [['2026-11-21', 647, 2], ['2026-11-20', 100.1, 1]])
  assert.deepEqual(result.sellers, [['ana', 'Ana'], ['unassigned', 'Não atribuído']])
})

test('seller filter keeps only that seller order costs and leaves company costs and manual entries out', () => {
  const ana = summarizeCashFlow(data, 'ana', manual)
  assert.equal(ana.totals.received, 547.1)
  assert.equal(ana.totals.automaticOut, 88.7)
  assert.equal(ana.totals.manualOut, 0)
  assert.deepEqual(ana.ledger.map(d => d.date), ['2026-11-21', '2026-11-20'])
  const unassigned = summarizeCashFlow(data, 'unassigned', manual)
  assert.deepEqual([unassigned.totals.received, unassigned.totals.automaticOut], [200, 30])
  assert.deepEqual(summarizeCashFlow(null, 'all').ledger, [])
})
