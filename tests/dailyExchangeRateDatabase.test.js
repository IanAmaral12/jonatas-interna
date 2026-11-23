import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('daily USD revaluation is exact, bounded, repeatable and service-only', async (t) => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table public.meta_exchange_rates (
        rate_date date primary key, base_currency text default 'USD', quote_currency text default 'BRL',
        rate numeric(18,8) not null, provider text, source text, fetched_at timestamptz default now(), raw_payload jsonb
      );
      create table public.meta_campaign_hourly_insights (
        campaign_id text primary key, metric_date date, currency text, spend numeric(18,6),
        spend_usd numeric(18,6), spend_brl numeric(18,6), exchange_rate_usd_brl numeric(18,8),
        exchange_rate_date date, raw_payload jsonb default '{"unchanged":true}'
      );
      grant all on public.meta_exchange_rates, public.meta_campaign_hourly_insights to service_role;
      insert into public.meta_campaign_hourly_insights
        (campaign_id,metric_date,currency,spend,spend_usd,spend_brl,exchange_rate_usd_brl,exchange_rate_date) values
        ('october','2026-10-31','USD',10,10,57.96,5.796,'2026-10-31'),
        ('sunday','2026-11-01','USD',10,10,57.96,5.796,'2026-11-01'),
        ('holiday','2026-11-02','USD',20,20,115.92,5.796,'2026-11-02'),
        ('tuesday','2026-11-03','USD',10,10,57.96,5.796,'2026-11-03'),
        ('fractional','2026-11-03','USD',0.000001,0.000001,0.000006,5.796,'2026-11-03'),
        ('zero','2026-11-03','USD',0,0,0,5.796,'2026-11-03'),
        ('brl','2026-11-03','BRL',100,17,100,5.796,'2026-11-03'),
        ('outside','2026-11-04','USD',10,10,57.96,5.796,'2026-11-04');
    `)
    const dir = new URL('../supabase/migrations/', import.meta.url)
    const file = (await readdir(dir)).find(f => f.endsWith('_daily_meta_usd_exchange_rates.sql'))
    assert.ok(file, 'Daily exchange-rate migration exists')
    await db.exec(await readFile(new URL(file, dir), 'utf8'))
    const observations = [
      { date: '2026-10-30', base: 'USD', quote: 'BRL', rate: 5 },
      { date: '2026-11-03', base: 'USD', quote: 'BRL', rate: 6 },
    ]
    const refresh = (start = '2026-11-01', end = '2026-11-03', rates = observations) =>
      db.query('select public.revalue_meta_usd_spend($1,$2,$3) updated', [start, end, JSON.stringify(rates)])

    await t.test('original spend controls exact conversion with holiday fallback; other periods and BRL are untouched', async () => {
      assert.equal((await refresh()).rows[0].updated, 5)
      const { rows } = await db.query('select campaign_id,spend_brl::text brl,exchange_rate_date::text rate_date from public.meta_campaign_hourly_insights order by campaign_id')
      assert.deepEqual(rows, [
        { campaign_id: 'brl', brl: '100.000000', rate_date: '2026-11-03' },
        { campaign_id: 'fractional', brl: '0.000006', rate_date: '2026-11-03' },
        { campaign_id: 'holiday', brl: '107.000000', rate_date: '2026-10-30' },
        { campaign_id: 'october', brl: '57.960000', rate_date: '2026-10-31' },
        { campaign_id: 'outside', brl: '57.960000', rate_date: '2026-11-04' },
        { campaign_id: 'sunday', brl: '53.500000', rate_date: '2026-10-30' },
        { campaign_id: 'tuesday', brl: '64.200000', rate_date: '2026-11-03' },
        { campaign_id: 'zero', brl: '0.000000', rate_date: '2026-11-03' },
      ])
      assert.equal((await db.query("select rate::text from public.meta_exchange_rates where rate_date='2026-10-30'")).rows[0].rate, '5.00000000')
      assert.equal((await db.query("select count(*)::int count from public.meta_campaign_hourly_insights where raw_payload = '{\"unchanged\":true}'")).rows[0].count, 8)
      assert.equal((await refresh()).rows[0].updated, 0)
    })
    await t.test('newly published close replaces provisional prior-day conversion without adding seven percent twice', async () => {
      await refresh('2026-11-01', '2026-11-03', [...observations, { date: '2026-11-02', base: 'USD', quote: 'BRL', rate: 5.5 }])
      assert.equal((await db.query("select spend_brl::text brl from public.meta_campaign_hourly_insights where campaign_id='holiday'")).rows[0].brl, '117.700000')
    })
    await t.test('uncovered dates abort atomically, and malformed or earlier requests are rejected', async () => {
      const before = (await db.query('select * from public.meta_campaign_hourly_insights order by campaign_id')).rows
      await assert.rejects(refresh('2026-10-31'), /período/i)
      await assert.rejects(refresh('2026-11-03', '2026-11-01'), /período/i)
      await assert.rejects(refresh('2026-11-01', '2026-12-15'), /período/i)
      for (const bad of [[], [{ ...observations[0], rate: -1 }], [{ ...observations[0], rate: '5' }], [{ ...observations[0], quote: 'EUR' }]]) {
        await assert.rejects(refresh('2026-11-01', '2026-11-03', bad), /cotação/i)
      }
      await db.exec("insert into public.meta_campaign_hourly_insights(campaign_id,metric_date,currency,spend) values ('missing','2026-11-30','USD',10)")
      await assert.rejects(refresh('2026-11-01', '2026-11-30'), /cotação/i)
      assert.deepEqual((await db.query("select * from public.meta_campaign_hourly_insights where campaign_id<>'missing' order by campaign_id")).rows, before)
    })
    await t.test('anonymous and authenticated clients cannot rewrite traffic; the existing service role can', async () => {
      for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`)
        await assert.rejects(refresh(), /permission denied/i)
        await db.exec('reset role')
      }
      await db.exec('set role service_role')
      await refresh()
      await db.exec('reset role')
    })
  } finally { await db.close() }
})
