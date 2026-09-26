import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  convertSpend,
  fixedExchangeRate,
  FIXED_USD_BRL_RATE,
  preserveExistingConversion,
} from '../supabase/functions/meta-ads-sync/exchange-rate.js'

const rate = fixedExchangeRate('2026-09-26')

test('fixed USD/BRL rate applies 3.5% over R$ 5.60', () => {
  assert.equal(FIXED_USD_BRL_RATE, 5.796)
  assert.deepEqual(convertSpend('USD', 10, rate), {
    spend_usd: 10,
    spend_brl: 57.96,
    exchange_rate_usd_brl: 5.796,
    exchange_rate_date: '2026-09-26',
  })
})

test('existing converted spend is unchanged when the Meta snapshot is unchanged', () => {
  const incoming = { spend: 10, ...convertSpend('USD', 10, rate) }
  const existing = {
    spend: '10',
    spend_usd: '10',
    spend_brl: '55',
    exchange_rate_usd_brl: '5.5',
    exchange_rate_date: '2026-09-25',
  }

  assert.deepEqual(preserveExistingConversion('USD', incoming, existing, rate), {
    spend: 10,
    spend_usd: 10,
    spend_brl: 55,
    exchange_rate_usd_brl: 5.5,
    exchange_rate_date: '2026-09-25',
  })
})

test('only new spend in an existing hourly bucket receives the fixed rate', () => {
  const incoming = { spend: 12, ...convertSpend('USD', 12, rate) }
  const existing = {
    spend: '10',
    spend_usd: '10',
    spend_brl: '55',
    exchange_rate_usd_brl: '5.5',
    exchange_rate_date: '2026-09-25',
  }
  const result = preserveExistingConversion('USD', incoming, existing, rate)

  assert.equal(result.spend_usd, 12)
  assert.equal(result.spend_brl, 66.592)
  assert.equal(result.exchange_rate_usd_brl, 66.592 / 12)
  assert.equal(result.exchange_rate_date, '2026-09-26')
})
