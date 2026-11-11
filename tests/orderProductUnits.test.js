import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sumProductUnits } from '../supabase/functions/orders-worker/order-units.js'

test('sums every product quantity in one order', () => {
  assert.equal(sumProductUnits([{ quantity: 2 }, { quantity: 3 }]), 5)
  assert.equal(sumProductUnits([{ quantity: '4' }]), 4)
})

test('rejects missing, empty, fractional, and invalid quantities', () => {
  for (const products of [null, [], [{}], [{ quantity: 0 }], [{ quantity: 1.5 }],
    [{ quantity: 2 }, { quantity: 'bad' }]]) {
    assert.equal(sumProductUnits(products), null)
  }
})
