import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const sellerA = '11111111-1111-4111-8111-111111111111'
const sellerB = '22222222-2222-4222-8222-222222222222'
const sellerC = '33333333-3333-4333-8333-333333333333'

test('monthly DRE reconciles costs, payments, settings, and access', async (t) => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table public.sellers (id uuid primary key, name text not null, active boolean not null default true);
      create table public.orders (
        id text primary key, seller_id uuid references public.sellers(id), data timestamptz,
        valor numeric, data_pagamento date, status_pagamento text,
        cancelado boolean not null default false, product_units integer
      );
      create table public.meta_ad_accounts (id text primary key, account_id text not null);
      create table public.meta_campaigns (
        id text primary key, ad_account_id text references public.meta_ad_accounts(id),
        seller_id uuid references public.sellers(id)
      );
      create table public.meta_campaign_hourly_insights (
        campaign_id text references public.meta_campaigns(id),
        ad_account_id text references public.meta_ad_accounts(id),
        bucket_start timestamptz, spend_brl numeric
      );
      insert into public.sellers(id,name) values
        ('${sellerA}','Ana'), ('${sellerB}','Bruno'), ('${sellerC}','Carla');
      insert into public.orders(id,seller_id,data,valor,data_pagamento,status_pagamento,product_units)
      select 'a-' || n, '${sellerA}',
        case when n=10 then '2026-11-01 02:30+00'::timestamptz
          else '2026-10-15 12:00+00'::timestamptz end,
        1000, case when n in (1,2,3,6) then '2026-10-20'::date end,
        case when n in (1,2,3) then 'Pago'
          when n=4 then 'Pago Parcial' when n=5 then 'Chargeback' else 'After Pay' end, 1
      from generate_series(1,10) n;
      insert into public.orders(id,seller_id,data,valor,status_pagamento,product_units)
        values ('unassigned',null,'2026-10-15 12:00+00',200,'Pago',2),
               ('cancelled','${sellerA}','2026-10-15 12:00+00',900,'Pago',3),
               ('november','${sellerA}','2026-11-01 03:30+00',100,'Pago',1);
      update public.orders set cancelado=true where id='cancelled';
      insert into public.meta_ad_accounts(id,account_id) values
        ('regular','regular'), ('excluded','1392600858079467');
      insert into public.meta_campaigns(id,ad_account_id,seller_id) values
        ('seller','regular','${sellerA}'),
        ('unassigned','regular',null),
        ('excluded-account','excluded','${sellerA}'),
        ('52598941009722','regular','${sellerA}');
      insert into public.meta_campaign_hourly_insights(campaign_id,ad_account_id,bucket_start,spend_brl) values
        ('seller','regular','2026-10-15 12:00+00',500),
        ('unassigned','regular','2026-10-15 12:00+00',20),
        ('excluded-account','excluded','2026-10-15 12:00+00',100),
        ('52598941009722','regular','2026-10-15 12:00+00',50);
    `)
    const filenames = await readdir(new URL('../supabase/migrations/', import.meta.url))
    const name = filenames.find((file) => file.endsWith('_create_financial_dre.sql'))
    assert.ok(name, 'financial DRE migration exists')
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))

    const asRole = async (role, action) => {
      await db.exec(`set role ${role}`)
      try { return await action() } finally { await db.exec('reset role') }
    }
    const rowsFor = async (month) => asRole('authenticated', async () =>
      (await db.query('select * from public.get_financial_dre($1)', [month])).rows)
    const insertSetting = (seller, month, salary, commission) => asRole('authenticated', () =>
      db.query(`insert into public.seller_financial_settings
        (seller_id,effective_month,monthly_salary,commission_pct) values ($1,$2,$3,$4)`,
      [seller, month, salary, commission]))

    await insertSetting(sellerA, '2026-10-01', 1000, 8)
    await insertSetting(sellerB, '2026-10-01', 200, null)

    await t.test('uses scheduled revenue for commission and only Pago for confirmed revenue', async () => {
      const rows = await rowsFor('2026-10-01')
      const ana = rows.find((row) => row.seller_id === sellerA)
      assert.equal(ana.order_count, 10)
      assert.equal(ana.product_units, 10)
      assert.equal(ana.scheduled_revenue, '10000.00')
      assert.equal(ana.confirmed_revenue, '3000.00')
      assert.equal(ana.salary_cost, '1000.00')
      assert.equal(ana.commission_cost, '800.00')
      assert.equal(ana.production_cost, '69.00')
      assert.equal(ana.shipping_cost, '300.00')
      assert.equal(ana.traffic_cost, '500.00')
      assert.equal(ana.total_cost, '2669.00')
      assert.equal(ana.confirmed_balance, '331.00')
      assert.equal(ana.remaining_to_break_even, '0.00')
      assert.equal(ana.surplus, '331.00')
    })

    await t.test('includes salary without activity and reconciles unassigned costs', async () => {
      const rows = await rowsFor('2026-10-01')
      const bruno = rows.find((row) => row.seller_id === sellerB)
      const unassigned = rows.find((row) => row.row_type === 'unassigned')
      const general = rows.find((row) => row.row_type === 'general')
      assert.equal(bruno.total_cost, '200.00')
      assert.equal(unassigned.scheduled_revenue, '200.00')
      assert.equal(unassigned.production_cost, '13.80')
      assert.equal(unassigned.shipping_cost, '30.00')
      assert.equal(unassigned.traffic_cost, '20.00')
      assert.equal(unassigned.total_cost, '63.80')
      assert.equal(general.total_cost, '2932.80')
      assert.equal(general.confirmed_revenue, '3200.00')
    })

    await t.test('late payment changes the original month, not the next month', async () => {
      await db.exec("update public.orders set status_pagamento='  pAgO  ', data_pagamento='2026-11-03' where id='a-4'")
      const october = (await rowsFor('2026-10-01')).find((row) => row.seller_id === sellerA)
      assert.equal(october.confirmed_revenue, '4000.00')
      assert.equal(october.total_cost, '2669.00')
      const november = (await rowsFor('2026-11-01')).find((row) => row.seller_id === sellerA)
      assert.equal(november.confirmed_revenue, '100.00')
      assert.equal(november.configuration_pending, true)
    })

    await t.test('commission remains effective but salary must be entered each month', async () => {
      await insertSetting(sellerA, '2026-11-01', 1100, null)
      const november = (await rowsFor('2026-11-01')).find((row) => row.seller_id === sellerA)
      assert.equal(november.commission_pct, '8.00')
      assert.equal(november.salary_cost, '1100.00')
      assert.equal(november.commission_cost, '8.00')
      await insertSetting(sellerA, '2026-12-01', null, 10)
      const october = (await rowsFor('2026-10-01')).find((row) => row.seller_id === sellerA)
      assert.equal(october.commission_pct, '8.00')
    })

    await t.test('does not treat absent salary or commission as zero', async () => {
      await db.exec(`insert into public.orders(id,seller_id,data,valor,status_pagamento,product_units)
        values ('missing-settings','${sellerC}','2026-10-20 12:00+00',500,'Pago',1)`)
      let carla = (await rowsFor('2026-10-01')).find((row) => row.seller_id === sellerC)
      assert.equal(carla.configuration_pending, true)
      assert.equal(carla.units_pending, false)
      assert.equal(carla.total_cost, null)

      await insertSetting(sellerC, '2026-10-01', 500, null)
      carla = (await rowsFor('2026-10-01')).find((row) => row.seller_id === sellerC)
      assert.equal(carla.configuration_pending, true)
      assert.equal(carla.commission_cost, null)

      await asRole('authenticated', () => db.query(`update public.seller_financial_settings
        set commission_pct=0 where seller_id=$1 and effective_month='2026-10-01'`, [sellerC]))
      carla = (await rowsFor('2026-10-01')).find((row) => row.seller_id === sellerC)
      assert.equal(carla.configuration_pending, false)
      assert.equal(carla.total_cost, '536.90')
    })

    await t.test('missing settings or units cannot produce a fabricated break-even', async () => {
      await db.exec(`insert into public.orders(id,seller_id,data,valor,status_pagamento,product_units)
        values ('unknown-units','${sellerC}','2026-10-20 12:00+00',500,'Pago',null)`)
      const rows = await rowsFor('2026-10-01')
      const carla = rows.find((row) => row.seller_id === sellerC)
      const general = rows.find((row) => row.row_type === 'general')
      assert.equal(carla.configuration_pending, false)
      assert.equal(carla.units_pending, true)
      assert.equal(carla.total_cost, null)
      assert.equal(carla.remaining_to_break_even, null)
      assert.equal(general.total_cost, null)
    })

    await t.test('validates settings and denies anonymous access', async () => {
      for (const [month, salary, commission] of [
        ['2026-10-15', 1, null], ['2026-11-01', -1, null],
        ['2026-11-01', null, 101], ['2026-11-01', null, null],
      ]) {
        await assert.rejects(insertSetting(sellerC, month, salary, commission), /check constraint/i)
      }
      await assert.rejects(rowsFor('2026-10-15'), /first day|month/i)
      await assert.rejects(asRole('anon', () => db.query("select * from public.get_financial_dre('2026-10-01')")),
        /permission denied/i)
      await assert.rejects(asRole('anon', () => db.query('select * from public.seller_financial_settings')),
        /permission denied/i)
    })
  } finally {
    await db.close()
  }
})
