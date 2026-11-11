import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sortSellerRanking, sellerSettingChanges } from '../src/lib/financialWorkspace.js'

test('ranking orders confirmed profits, retains losses and separates incomplete sellers without mutating rows', () => {
  const rows = Object.freeze([
    Object.freeze({ row_type: 'seller', seller_id: 'pending', seller_name: 'Aline', confirmed_profit: null, pending: { payment_fee: 1 } }),
    Object.freeze({ row_type: 'seller', seller_id: 'loss', seller_name: 'Zeca', confirmed_profit: '-20', pending: {} }),
    Object.freeze({ row_type: 'seller', seller_id: 'b', seller_name: 'Bruna', confirmed_profit: '50', pending: {} }),
    Object.freeze({ row_type: 'unassigned', seller_name: 'Não atribuído', confirmed_profit: 999, pending: {} }),
    Object.freeze({ row_type: 'seller', seller_id: 'a', seller_name: 'Ana', confirmed_profit: 50, pending: {} }),
    Object.freeze({ row_type: 'seller', seller_id: 'best', seller_name: 'Carlos', confirmed_profit: 100, pending: {} }),
  ])
  assert.deepEqual(sortSellerRanking(rows).map((row) => row.seller_id), ['best', 'a', 'b', 'loss', 'pending'])
  assert.equal(rows[0].seller_id, 'pending')
  assert.equal(rows[0].confirmed_profit, null)
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
