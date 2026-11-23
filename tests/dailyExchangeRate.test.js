import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as rates from '../supabase/functions/meta-ads-sync/exchange-rate.js'

const observations = [
  { date: '2026-10-30', base: 'USD', quote: 'BRL', rate: 5 },
  { date: '2026-11-03', base: 'USD', quote: 'BRL', rate: 6 },
]

test('daily conversion uses the latest observed BCB rate on or before the expense date plus seven percent', () => {
  const sunday = rates.exchangeRateForDate('2026-11-01', observations)
  assert.equal(sunday.date, '2026-10-30')
  assert.equal(sunday.rate, 5.35)
  assert.equal(sunday.baseRate, 5)
  assert.equal(rates.exchangeRateForDate('2026-11-03', observations).rate, 6.42)
  assert.throws(() => rates.exchangeRateForDate('2026-10-29', observations), /cotação/i)
  assert.throws(() => rates.exchangeRateForDate('2026-11-25', observations), /cotação/i)
})

test('November USD snapshots are fully revalued, including unchanged or reduced spend, without compounding the surcharge', () => {
  const rate = { date: '2026-10-30', rate: 5.35 }
  for (const spend of [10, 8, 0]) {
    const incoming = { spend, ...rates.convertSpend('USD', spend, rate) }
    const existing = { spend: 10, spend_usd: 10, spend_brl: 57.96, exchange_rate_usd_brl: 5.796, exchange_rate_date: '2026-11-01' }
    const result = rates.preserveExistingConversion('USD', incoming, existing, rate, '2026-11-01')
    assert.equal(result.spend_brl, spend === 10 ? 53.5 : spend === 8 ? 42.8 : 0)
    assert.deepEqual(rates.preserveExistingConversion('USD', incoming, result, rate, '2026-11-01'), result)
  }
})

test('October stored conversions and native BRL spend remain unchanged', () => {
  const rate = { date: '2026-10-30', rate: 5.35 }
  const existing = { spend: 10, spend_usd: 10, spend_brl: 57.96, exchange_rate_usd_brl: 5.796, exchange_rate_date: '2026-10-31' }
  const incoming = { spend: 10, ...rates.convertSpend('USD', 10, rate) }
  assert.equal(rates.preserveExistingConversion('USD', incoming, existing, rate, '2026-10-31').spend_brl, 57.96)
  assert.equal(rates.convertSpend('BRL', 12.34, rate).spend_brl, 12.34)
})

test('API requests pin BCB and include preceding days for weekends; invalid responses cannot become exchange rates', async () => {
  const fetched = await rates.fetchExchangeRates('2026-11-01', '2026-11-03', async (url, options) => {
    assert.equal(url.searchParams.get('providers'), 'BCB')
    assert.equal(url.searchParams.get('base'), 'USD')
    assert.equal(url.searchParams.get('quotes'), 'BRL')
    assert.equal(url.searchParams.get('from'), '2026-10-18')
    assert.equal(url.searchParams.get('to'), '2026-11-03')
    assert.ok(options.signal)
    return Response.json(observations)
  })
  assert.deepEqual(fetched, observations)
  for (const body of [[], [{ ...observations[0], rate: 0 }], [{ ...observations[0], rate: null }], [{ ...observations[0], rate: '5' }], [{ ...observations[0], quote: 'EUR' }], [{ ...observations[0], date: '2026-11-04' }], [{ ...observations[0], date: '2026-02-30' }]]) {
    await assert.rejects(rates.fetchExchangeRates('2026-11-01', '2026-11-03', async () => Response.json(body)), /cotação|câmbio/i)
  }
})

test('API failures never invent a fixed rate', async () => {
  await assert.rejects(rates.fetchExchangeRates('2026-11-01', '2026-11-03', async () => new Response('', { status: 503 })), /503/)
  await assert.rejects(rates.fetchExchangeRates('2026-11-01', '2026-11-03', async () => { throw new Error('network unavailable') }), /network unavailable/)
})
