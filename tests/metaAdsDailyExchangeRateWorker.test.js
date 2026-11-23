import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { randomUUID } from 'node:crypto'
import * as rates from '../supabase/functions/meta-ads-sync/exchange-rate.js'

test('the deployed worker path persists BCB observations and uses daily rates for live and historical USD snapshots', async () => {
  const source = await readFile(new URL('../supabase/functions/meta-ads-sync/index.ts', import.meta.url), 'utf8')
  const executable = stripTypeScriptTypes(source.replace(/^import[\s\S]*?;\r?\n/gm, ''))
  for (const scenario of ['sync', 'historical', 'api failure', 'database failure']) {
    const calls = []
    let handler
    const client = {
      rpc: async (name, args) => {
        calls.push({ name, args })
        if (name === 'revalue_meta_usd_spend' && scenario === 'database failure') return { error: { message: 'revaluation unavailable' } }
        return { data: name === 'claim_meta_ads_worker' ? true : 1 }
      },
      from: (table) => {
        const chain = {
          insert: async () => ({ data: [] }), upsert: async () => ({ data: [] }),
          update: () => chain, eq: () => chain, in: () => chain, order: () => chain,
          select: () => chain, range: () => chain,
          then: (resolve) => resolve({ data: table === 'meta_campaign_hourly_insights' ? [{
            campaign_id: 'campaign-act_1010965721683924', hour_start: 10, spend: 10, spend_usd: 10,
            spend_brl: 57.96, exchange_rate_usd_brl: 5.796, exchange_rate_date: '2026-11-01',
          }] : [] }),
        }
        return chain
      },
    }
    const fetcher = async (input) => {
      const url = new URL(input)
      if (url.hostname === 'api.frankfurter.dev') {
        if (scenario === 'api failure') return new Response('', { status: 503 })
        return Response.json([
          { date: '2026-10-30', base: 'USD', quote: 'BRL', rate: 5 },
          { date: '2026-11-03', base: 'USD', quote: 'BRL', rate: 6 },
        ])
      }
      const account = url.pathname.split('/')[2]
      if (url.pathname.endsWith('/insights')) return Response.json({ data: [{
        campaign_id: `campaign-${account}`, campaign_name: 'CP LUCAS', spend: '10',
        hourly_stats_aggregated_by_advertiser_time_zone: '10:00:00 - 10:59:59',
      }] })
      return Response.json({ id: account, account_id: account.slice(4), currency: account === 'act_1010965721683924' ? 'USD' : 'BRL', timezone_name: 'America/Sao_Paulo', name: 'Synthetic account' })
    }
    class Clock extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-04T15:00:00Z'])) } }
    runInNewContext(executable, {
      ...rates,
      fetchExchangeRates: (start, end) => rates.fetchExchangeRates(start, end, fetcher),
      Deno: { env: { get: () => 'synthetic-test-value' }, serve: fn => { handler = fn } },
      createClient: () => client, fetch: fetcher, Date: Clock, URL, TextEncoder, Response,
      crypto: { randomUUID }, console: { error: () => {} }, setTimeout,
    })
    const body = scenario === 'historical'
      ? { mode: 'historical_backfill', start_date: '2026-11-01', end_date: '2026-11-03', account_ids: ['1010965721683924'] }
      : { mode: 'sync' }
    const response = await handler(new Request('https://worker.invalid', { method: 'POST', headers: { 'x-worker-secret': 'synthetic-test-value', 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    const snapshots = calls.filter(c => c.name === 'replace_meta_hourly_insights')
    if (scenario.endsWith('failure')) {
      assert.equal(response.status, 500, scenario)
      assert.equal(snapshots.length, 0, 'Failed exchange lookup cannot overwrite traffic')
    } else {
      assert.equal(response.status, 200)
      assert.ok(calls.some(c => c.name === 'revalue_meta_usd_spend'), 'Daily rates are persisted and existing traffic reconciled')
      const usd = snapshots.filter(c => c.args.p_account_id === 'act_1010965721683924')
      assert.equal(usd.length, scenario === 'historical' ? 3 : 1)
      assert.deepEqual(usd.map(c => c.args.p_rows[0].spend_brl), scenario === 'historical' ? [53.5, 53.5, 64.2] : [64.2])
      const result = await response.json()
      if (scenario === 'sync') {
        assert.equal(result.exchange_rate.provider, 'BCB')
        assert.equal(result.exchange_rate.surcharge_percentage, 7)
      }
    }
    assert.equal(calls.at(-1).name, 'release_meta_ads_worker')
  }
})
