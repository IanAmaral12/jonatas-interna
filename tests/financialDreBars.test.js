import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateBreakEvenBars } from '../src/lib/financialDreBars.js'

test('cost and paid bars share one scale and show the shortfall', () => {
  const bars = calculateBreakEvenBars(2700, 1000)
  assert.equal(bars.costPercent, 100)
  assert.ok(Math.abs(bars.paidPercent - 1000 / 2700 * 100) < 0.001)
  assert.equal(bars.remaining, 1700)
  assert.equal(bars.surplus, 0)
})

test('paid revenue past break-even fills the scale and shows surplus', () => {
  assert.deepEqual(calculateBreakEvenBars(2700, 3000), {
    costPercent: 90, paidPercent: 100, remaining: 0, surplus: 300,
  })
})

test('zero costs and incomplete values have distinct states', () => {
  assert.deepEqual(calculateBreakEvenBars(0, 0), {
    costPercent: 0, paidPercent: 0, remaining: 0, surplus: 0,
  })
  assert.deepEqual(calculateBreakEvenBars(null, 100), {
    costPercent: null, paidPercent: null, remaining: null, surplus: null,
  })
})
