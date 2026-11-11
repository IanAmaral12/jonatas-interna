import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFinancialDecimal } from '../src/lib/financialDreSettings.js'

test('accepts Brazilian salary and commission formats, including zero', () => {
  assert.equal(parseFinancialDecimal('1.000,00', 999999999999.99), 1000)
  assert.equal(parseFinancialDecimal('1000,00', 999999999999.99), 1000)
  assert.equal(parseFinancialDecimal('8,5', 100), 8.5)
  assert.equal(parseFinancialDecimal('0', 100), 0)
})

test('rejects ambiguous, invalid, and out-of-range amounts', () => {
  assert.equal(parseFinancialDecimal('1.000.00', 999999999999.99), null)
  assert.equal(parseFinancialDecimal('-100', 999999999999.99), null)
  assert.equal(parseFinancialDecimal('8,555', 100), null)
  assert.equal(parseFinancialDecimal('101', 100), null)
})
