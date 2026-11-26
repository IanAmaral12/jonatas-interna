import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const ana = '11111111-1111-4111-8111-111111111111'
const bruno = '22222222-2222-4222-8222-222222222222'

test('cash flow lists received payments and every automatic cost on the day it happens', async (t) => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; set time zone 'UTC';
      create table public.sellers(id uuid primary key,name text,active boolean default true);
      create table public.orders(id text primary key,seller_id uuid,data timestamptz,valor numeric,nome_cliente text,status_pagamento text,
        status_rastreio text,data_pagamento date,cancelado boolean default false,product_units integer,codigo_rastreio text);
      create schema pgmq; create table pgmq.a_orders_ingest(msg_id bigint,enqueued_at timestamptz,message jsonb);
      create table public.meta_ad_accounts(id text primary key,account_id text);
      create table public.meta_campaigns(id text primary key,ad_account_id text,seller_id uuid);
      create table public.meta_campaign_hourly_insights(campaign_id text,ad_account_id text,bucket_start timestamptz,spend_brl numeric);`)
    const files = await readdir(new URL('../supabase/migrations/', import.meta.url))
    for (const suffix of ['_create_financial_dre.sql', '_order_financial_snapshots.sql', '_financial_workspace.sql',
      '_reconcile_confirmed_order_payments.sql', '_cost_types_categories_recurring.sql', '_cash_flow_daily_costs.sql']) {
      const name = files.find(file => file.endsWith(suffix))
      assert.ok(name, `${suffix} migration exists`)
      await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
    }
    await db.exec(`insert into public.sellers values ('${ana}','Ana'),('${bruno}','Bruno');
      insert into public.orders values
        ('p0','${bruno}','2026-11-05 12:00+00',50,'Cliente 0','Pago','Entregue','2026-11-05',false,1,null),
        ('p1','${ana}','2026-11-20 12:00+00',447,'Cliente 1','Pago','Entregue','2026-11-21',false,2,'BR1'),
        ('p2','${ana}','2026-11-21 12:00+00',200,'Cliente 2','Pago Parcial','Em transito',null,false,1,null),
        ('p3','${bruno}','2026-11-20 12:00+00',100,'Cliente 3','Pago','Entregue','2026-11-20',false,1,null),
        ('p4','${ana}','2026-11-21 13:00+00',300,'Cliente 4','After Pay','Pedido Criado',null,false,1,null),
        ('c1','${ana}','2026-11-21 12:00+00',90,'Cliente 5','After Pay','Cancelado',null,true,5,null),
        ('x1','${bruno}','2026-11-25 12:00+00',100,'Cliente 6','Pago','Entregue','2026-11-30',false,1,null);
      insert into public.seller_financial_settings(seller_id,effective_month,monthly_salary,commission_pct,commission_type) values
        ('${ana}','2026-11-01',3000,10,'fixed_per_paid'),('${bruno}','2026-10-01',null,10,'scheduled_pct');
      insert into public.financial_monthly_taxes values ('2026-11-01',40);
      insert into public.financial_cost_entries(description,amount,cost_date,category) values ('Agência',60,'2026-11-21','marketing');
      insert into public.financial_recurring_costs(description,amount,category,start_month) values ('Aluguel',300,'estrutura','2026-11-01');
      insert into public.meta_ad_accounts values ('regular','regular'),('excluded','1392600858079467');
      insert into public.meta_campaigns values ('ana','regular','${ana}'),('excluded','excluded','${ana}');
      insert into public.meta_campaign_hourly_insights values ('ana','regular','2026-11-20 15:00+00',80),('excluded','excluded','2026-11-20 15:00+00',999),
        ('ana','regular','2026-11-21 02:30+00',5);`)
    const write = (id, payload, msg, at) => db.query('select public.record_order_financial_snapshot($1,$2,$3,$4)', [id, payload, msg, at])
    await write('p0', { transaction: { payment_status: 'Pago', paid_amount: 5000, acquirer_cost: 0, affiliate_earned: 0 } }, 1, '2026-11-05T15:00:00Z')
    await write('p1', { skaletracking: { plataforma: 'PagarMe' }, transaction: { payment_status: 'Pago', paid_amount: 44700, acquirer_cost: 1000, affiliate_earned: 500 } }, 2, '2026-11-21T15:00:00Z')
    await write('p2', { transaction: { payment_status: 'Pago Parcial', paid_amount: 20000, acquirer_cost: 0, affiliate_earned: 0 } }, 3, '2026-11-22T02:00:00Z')
    await write('p3', { transaction: { payment_status: 'Pago', paid_amount: 10000, acquirer_cost: 0, affiliate_earned: 0 } }, 4, '2026-11-20T15:00:00Z')
    await write('x1', { transaction: { payment_status: 'Pago', paid_amount: 10000, acquirer_cost: 0, affiliate_earned: 0 } }, 5, '2026-11-30T15:00:00Z')
    const cashFlow = async (start, end, role = 'authenticated') => {
      await db.exec(`set role ${role}`)
      try { return (await db.query('select public.get_cash_flow($1,$2) as result', [start, end])).rows[0].result }
      finally { await db.exec('reset role') }
    }
    const totals = (lines) => {
      const map = {}
      for (const line of lines) map[`${line.day}:${line.source}`] = Math.round(((map[`${line.day}:${line.source}`] || 0) + Number(line.amount)) * 100) / 100
      return map
    }

    await t.test('payments use the payment date, or the receipt time in Brasília when it is missing', async () => {
      const result = await cashFlow('2026-11-20', '2026-11-22')
      assert.deepEqual(result.payments.map(p => [p.order_id, p.paid_date, Number(p.amount), p.estimated_date, p.seller_name]), [
        ['p3', '2026-11-20', 100, false, 'Bruno'], ['p1', '2026-11-21', 447, false, 'Ana'], ['p2', '2026-11-21', 200, true, 'Ana'],
      ])
      assert.equal(result.payments[1].platform, 'PagarMe')
      assert.equal(result.payments[1].customer_name, 'Cliente 1')
    })

    await t.test('order, payment, traffic and monthly costs land on their days with tax split among paid orders', async () => {
      const result = await cashFlow('2026-11-20', '2026-11-21')
      assert.deepEqual(totals(result.lines), {
        '2026-11-20:payment': 100, '2026-11-20:shipping': 60, '2026-11-20:production': 20.7, '2026-11-20:skale': 1,
        '2026-11-20:commission': 10, '2026-11-20:tax': 8, '2026-11-20:traffic': 85, '2026-11-20:salary': 100, '2026-11-20:recurring': 10,
        '2026-11-21:payment': 647, '2026-11-21:shipping': 60, '2026-11-21:production': 13.8, '2026-11-21:skale': 1.5,
        '2026-11-21:payment_fee': 10, '2026-11-21:external_commission': 5, '2026-11-21:commission': 20, '2026-11-21:tax': 16,
        '2026-11-21:salary': 100, '2026-11-21:recurring': 10, '2026-11-21:expense': 60,
      })
      const line = (day, source) => result.lines.filter(l => l.day === day && l.source === source)
      assert.deepEqual(line('2026-11-20', 'traffic').map(l => l.seller_id), [ana])
      assert.deepEqual(line('2026-11-20', 'recurring').map(l => [l.seller_id, l.category, l.description]), [[null, 'estrutura', 'Aluguel']])
      assert.deepEqual(line('2026-11-21', 'expense').map(l => [l.category, l.description]), [['marketing', 'Agência']])
      assert.deepEqual(line('2026-11-21', 'production').map(l => Number(l.quantity)), [2])
      assert.ok(result.lines.every(l => l.direction === (l.source === 'payment' ? 'in' : 'out') && Number(l.amount) > 0))
      assert.deepEqual(result.sellers.map(s => s.name), ['Ana', 'Bruno'])
      assert.equal(result.tax_pending_months.length, 0)
    })

    await t.test('months without launched tax are reported as pending', async () => {
      const result = await cashFlow('2026-12-01', '2026-12-02')
      assert.deepEqual(result.tax_pending_months, ['2026-12-01'])
      assert.equal(totals(result.lines)['2026-12-01:recurring'], 9.68)
    })

    await t.test('validates the period and blocks anonymous access', async () => {
      await assert.rejects(cashFlow('2026-11-22', '2026-11-20'), /period/i)
      await assert.rejects(cashFlow('2025-01-01', '2026-11-20'), /period/i)
      await assert.rejects(cashFlow('2026-11-20', '2026-11-22', 'anon'), /permission denied/i)
    })
  } finally { await db.close() }
})
