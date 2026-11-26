import { test } from 'node:test'
import assert from 'node:assert/strict'
import { costsByCategory, formatCommission, sortSellerRanking, sellerSettingChanges } from '../src/lib/financialWorkspace.js'

test('commission types change the value limit and are saved with their value', () => {
  const setting = { monthly_salary: 0, commission_pct: '8.00', commission_type: 'scheduled_pct' }
  assert.deepEqual(sellerSettingChanges(setting, { salary: '', commission: '150', commissionType: 'fixed_per_paid' }), { commission_pct: 150, commission_type: 'fixed_per_paid' })
  assert.deepEqual(sellerSettingChanges(setting, { salary: '', commission: '8', commissionType: 'paid_pct' }), { commission_pct: 8, commission_type: 'paid_pct' })
  assert.deepEqual(sellerSettingChanges(setting, { salary: '', commission: '8', commissionType: 'scheduled_pct' }), {})
  assert.throws(() => sellerSettingChanges(setting, { salary: '', commission: '150', commissionType: 'paid_pct' }), /comissão/i)
  assert.throws(() => sellerSettingChanges(setting, { salary: '', commission: '', commissionType: 'fixed_per_shipped' }), /comissão/i)
  assert.equal(formatCommission('fixed_per_shipped', 15).replace(/\s/g, ' '), 'R$ 15,00 por pedido enviado')
  assert.equal(formatCommission('paid_pct', 2), '2% do valor recebido')
  assert.equal(formatCommission(null, null), 'não configurada')
})

test('costs by category join automatic, general and recurring costs sorted by amount', () => {
  const summary = { salary_cost: 1000, commission_cost: 200, production_cost: 69, shipping_cost: 300, traffic_cost: 500,
    skale_cost: 5, payment_fee_cost: 30, external_commission_cost: 20, allocated_tax: 10, unallocated_tax: 5 }
  const result = costsByCategory(summary, [{ category: 'marketing', amount: '60' }, { category: 'outros', amount: 40 }],
    [{ category: 'estrutura', amount: 500 }])
  assert.deepEqual(result.map(({ key, amount }) => [key, amount]), [
    ['pessoal', 1200], ['marketing', 580], ['estrutura', 500], ['logistica', 300], ['producao', 69],
    ['outros', 40], ['financeiro', 35], ['impostos', 15],
  ])
  assert.equal(result[0].label, 'Pessoal')
})

test('ranking orders known profits including incomplete sellers without mutating rows', () => {
  const rows = Object.freeze([
    Object.freeze({ row_type: 'seller', seller_id: 'pending', seller_name: 'Aline', confirmed_profit: 80, pending: { payment_fee: 1 } }),
    Object.freeze({ row_type: 'seller', seller_id: 'loss', seller_name: 'Zeca', confirmed_profit: '-20', pending: {} }),
    Object.freeze({ row_type: 'seller', seller_id: 'b', seller_name: 'Bruna', confirmed_profit: '50', pending: {} }),
    Object.freeze({ row_type: 'unassigned', seller_name: 'Não atribuído', confirmed_profit: 999, pending: {} }),
    Object.freeze({ row_type: 'seller', seller_id: 'a', seller_name: 'Ana', confirmed_profit: 50, pending: {} }),
    Object.freeze({ row_type: 'seller', seller_id: 'best', seller_name: 'Carlos', confirmed_profit: 100, pending: {} }),
  ])
  assert.deepEqual(sortSellerRanking(rows).map((row) => row.seller_id), ['best', 'pending', 'a', 'b', 'loss'])
  assert.equal(rows[0].seller_id, 'pending')
  assert.equal(rows[0].confirmed_profit, 80)
})

test('salary-only save preserves historical commission and explicit zero', () => {
  const setting = { monthly_salary: null, commission_pct: '8.00', month_commission_pct: null }
  assert.deepEqual(sellerSettingChanges(setting, { salary: '0', commission: '8' }), { monthly_salary: 0 })
  assert.deepEqual(sellerSettingChanges(setting, { salary: '', commission: '9,5' }), { commission_pct: 9.5 })
  assert.deepEqual(sellerSettingChanges({ ...setting, monthly_salary: '1000' }, { salary: '1.000,00', commission: '8' }), {})
  assert.deepEqual(sellerSettingChanges({ ...setting, commission_pct: 9 }, { salary: '1000', commission: '8', dirty: { salary: true } }), { monthly_salary: 1000 })
  assert.throws(() => sellerSettingChanges(setting, { salary: 'invalid', commission: '8' }), /salário/i)
  assert.throws(() => sellerSettingChanges(setting, { salary: '', commission: '101' }), /comissão/i)
})
