import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const ana = '11111111-1111-4111-8111-111111111111'
const bruno = '22222222-2222-4222-8222-222222222222'
const carla = '33333333-3333-4333-8333-333333333333'

test('financial workspace reconciles receipts, known costs, taxes and access', async (t) => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.sellers(id uuid primary key,name text,active boolean default true);
      create table public.orders(id text primary key,seller_id uuid references public.sellers(id),data timestamptz,
        valor numeric,status_pagamento text,status_rastreio text,cancelado boolean default false,product_units integer);
      create schema pgmq; create table pgmq.a_orders_ingest(msg_id bigint,enqueued_at timestamptz,message jsonb);
      create table public.meta_ad_accounts(id text primary key,account_id text);
      create table public.meta_campaigns(id text primary key,ad_account_id text,seller_id uuid);
      create table public.meta_campaign_hourly_insights(campaign_id text,ad_account_id text,bucket_start timestamptz,spend_brl numeric);`)
    const files = await readdir(new URL('../supabase/migrations/', import.meta.url))
    for (const suffix of ['_create_financial_dre.sql', '_order_financial_snapshots.sql', '_financial_workspace.sql']) {
      const name = files.find(f => f.endsWith(suffix))
      assert.ok(name, `${suffix} migration exists`)
      await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
    }
    await db.exec(`insert into public.sellers values ('${ana}','Ana',true),('${bruno}','Bruno',false),('${carla}','Carla',true);
      insert into public.orders(id,seller_id,data,valor,status_pagamento,product_units)
        select 'a-'||n,'${ana}',case when n=10 then '2026-11-01 02:30+00'::timestamptz else '2026-10-15 12:00+00' end,
          1000, 'After Pay',1 from generate_series(1,10) n;
      insert into public.seller_financial_settings values ('${ana}','2026-10-01',1000,8);
      insert into public.meta_ad_accounts values ('regular','regular'),('excluded','1392600858079467');
      insert into public.meta_campaigns values ('seller','regular','${ana}'),('excluded','excluded','${ana}'),('52598941009722','regular','${ana}');
      insert into public.meta_campaign_hourly_insights values ('seller','regular','2026-10-15 12:00+00',500),
        ('excluded','excluded','2026-10-15 12:00+00',100),('52598941009722','regular','2026-10-15 12:00+00',100);
      insert into public.financial_monthly_taxes values ('2026-10-01',10);
      insert into public.financial_cost_entries(description,amount,cost_date) values ('General expense',40,'2026-10-15');`)
    const write = (id,payload,msg=1) => db.query('select public.record_order_financial_snapshot($1,$2,$3,$4)',[id,payload,msg,'2026-11-05T12:00:00Z'])
    await write('a-1',{transaction:{payment_status:'Pago',paid_amount:100000,acquirer_cost:1000,affiliate_earned:500}})
    await write('a-2',{transaction:{payment_status:'Pago Parcial',paid_amount:200000,acquirer_cost:2000,affiliate_earned:1500}})
    const asRole = async (role, fn) => {
      await db.exec(`savepoint role_action; set role ${role}`)
      try { return await fn() }
      catch (error) { await db.exec('rollback to savepoint role_action'); throw error }
      finally { await db.exec('reset role; release savepoint role_action') }
    }
    const workspace = (month='2026-10-01') => asRole('authenticated',async()=>
      (await db.query('select public.get_financial_workspace($1) as result',[month])).rows[0].result)
    const check = (name,fn) => t.test(name,async()=>{ await db.exec('begin'); try { await fn() } finally { await db.exec('rollback') } })
    await check('agreed ten-order example totals 2734 cost, 266 seller and 226 consolidated profit',async()=>{
      const result = await workspace(); const row = result.rows.find(r=>r.seller_id===ana)
      assert.equal(result.month,'2026-10-01')
      for (const [field,value] of Object.entries({order_count:10,product_units:10,scheduled_revenue:10000,commission_base_revenue:10000,
        known_received_revenue:3000,confirmed_revenue:3000,salary_cost:1000,commission_pct:8,commission_cost:800,
        production_cost:69,shipping_cost:300,traffic_cost:500,skale_cost:5,payment_fee_cost:30,external_commission_cost:20,
        allocated_tax:10,known_cost:2734,total_cost:2734,confirmed_profit:266,remaining_to_break_even:0,surplus:266})) assert.equal(Number(row[field]),value,field)
      assert.equal(Number(result.summary.confirmed_profit),226)
      assert.equal(Number(result.summary.general_expenses),40)
      assert.equal(Number(result.summary.total_cost),2774)
      assert.equal(result.summary.tax_recorded,true)
      assert.deepEqual(row.pending,{salary:0,commission:0,units:0,payment_fee:0,received_amount:0,external_commission:0})
      assert.equal(result.rows.length,1)
      assert.ok(result.seller_settings.some(s=>s.seller_id===carla))
      assert.equal(result.seller_settings.find(s=>s.seller_id===ana).month_commission_pct,8)
      assert.deepEqual(result.rates,{production:6.9,shipping:30,skale:0.5})
    })
    await check('source gaps retain known per-order subtotals and block profit and breakeven',async()=>{
      await db.exec("update public.orders set product_units=null where id='a-3'")
      await write('a-3',{transaction:{payment_status:'Parcial',total_price:100000}})
      const result=await workspace(); const row=result.rows[0]
      assert.equal(Number(row.production_cost),62.1)
      assert.equal(Number(row.payment_fee_cost),30)
      assert.equal(Number(row.external_commission_cost),20)
      assert.equal(Number(row.known_received_revenue),3000)
      assert.equal(row.confirmed_revenue,null)
      assert.equal(row.total_cost,null)
      assert.equal(row.confirmed_profit,null)
      assert.equal(row.remaining_to_break_even,null)
      assert.deepEqual(row.pending,{salary:0,commission:0,units:1,payment_fee:1,received_amount:1,external_commission:1})
      assert.equal(result.summary.total_cost,null)
      assert.equal(result.summary.confirmed_profit,null)
    })
    await check('receipt-only gaps keep complete cost but cannot close revenue, profit or breakeven',async()=>{
      await write('a-3',{transaction:{payment_status:'Parcial',acquirer_cost:0,affiliate_earned:0}})
      const row=(await workspace()).rows[0]
      assert.equal(row.pending.received_amount,1)
      assert.equal(row.total_cost,2734)
      assert.equal(row.confirmed_revenue,null)
      assert.equal(row.confirmed_profit,null)
      assert.equal(row.remaining_to_break_even,null)
    })
    await check('refund with prior payment but missing fee remains pending',async()=>{
      await write('a-3',{transaction:{payment_status:'Pago',paid_amount:10000,affiliate_earned:0}})
      await write('a-3',{transaction:{payment_status:'Estornado'}},2)
      const row=(await workspace()).rows[0]
      assert.equal(row.pending.payment_fee,1)
      assert.equal(row.payment_fee_cost,30)
      assert.equal(row.confirmed_revenue,3000)
      assert.equal(row.total_cost,null)
    })
    await check('versioned payment and shipping beat regressed fields, cancellation is exact and Skale counts all',async()=>{
      await write('a-3',{skaletracking:{status_entrega:'Devolvido'}})
      await write('a-4',{skaletracking:{status_entrega:'Em Devolução'}})
      await write('a-5',{skaletracking:{status_entrega:' Cancelado '}})
      await write('a-6',{skaletracking:{status_entrega:'Taxa de Cancelamento Pago'}})
      await db.exec("update public.orders set status_rastreio='Em trânsito',status_pagamento='After Pay'; update public.orders set cancelado=true where id='a-7'")
      const row=(await workspace()).rows[0]
      assert.equal(Number(row.production_cost),48.3)
      assert.equal(Number(row.shipping_cost),240)
      assert.equal(Number(row.skale_cost),5)
      assert.equal(Number(row.commission_base_revenue),8000)
      assert.equal(Number(row.scheduled_revenue),10000)
      assert.equal(Number(row.confirmed_revenue),3000)
    })
    await check('fee persists after refund; never-paid orders do not invent fees',async()=>{
      await write('a-1',{transaction:{payment_status:'Chargeback'}},2)
      const row=(await workspace()).rows[0]
      assert.equal(Number(row.confirmed_revenue),2000)
      assert.equal(Number(row.payment_fee_cost),30)
      assert.equal(Number(row.external_commission_cost),15)
      assert.equal(row.pending.payment_fee,0)
    })
    await check('salary is exact-month, commission persists historically and inactive salary-only seller appears',async()=>{
      await db.exec(`insert into public.seller_financial_settings values ('${ana}','2026-11-01',1100,null),('${ana}','2026-12-01',null,10),('${bruno}','2026-10-01',200,null);
        insert into public.orders values ('november','${ana}','2026-11-01 03:30+00',100,'After Pay',null,false,1);`)
      let result=await workspace(); assert.equal(result.rows.find(r=>r.seller_id===bruno).total_cost,200)
      assert.equal(result.rows.find(r=>r.seller_id===ana).commission_pct,8)
      result=await workspace('2026-11-01')
      assert.equal(result.rows[0].salary_cost,1100)
      assert.equal(result.rows[0].commission_pct,8)
      assert.equal(result.seller_settings.find(r=>r.seller_id===ana).commission_effective_month,'2026-10-01')
      assert.equal(result.seller_settings.find(r=>r.seller_id===ana).month_commission_pct,null)
    })
    await check('missing seller settings are explicit but zero salary and commission are valid',async()=>{
      await db.exec(`update public.orders set seller_id='${carla}' where id='a-10'`)
      let row=(await workspace()).rows.find(r=>r.seller_id===carla)
      assert.equal(row.pending.salary,1); assert.equal(row.pending.commission,1); assert.equal(row.total_cost,null)
      await asRole('authenticated',()=>db.exec(`insert into public.seller_financial_settings values ('${carla}','2026-10-01',0,0)`))
      row=(await workspace()).rows.find(r=>r.seller_id===carla)
      assert.equal(row.total_cost,37.4)
    })
    await check('largest remainder tax allocation and unassigned traffic reconcile without double charge',async()=>{
      await db.exec(`update public.financial_monthly_taxes set tax_paid=100.01;
        insert into public.orders values ('unassigned',null,'2026-10-15',200,'After Pay',null,false,1);
        insert into public.meta_campaigns values ('unassigned','regular',null);
        insert into public.meta_campaign_hourly_insights values ('unassigned','regular','2026-10-15',20);`)
      await write('unassigned',{transaction:{payment_status:'Pago',paid_amount:20000,acquirer_cost:0,affiliate_earned:0}})
      const result=await workspace(); const seller=result.rows.find(r=>r.seller_id===ana); const unassigned=result.rows.find(r=>r.row_type==='unassigned')
      assert.equal(seller.allocated_tax,66.67); assert.equal(unassigned.allocated_tax,33.34)
      assert.equal(unassigned.traffic_cost,20)
      assert.equal(result.summary.allocated_tax,100.01)
      assert.equal(result.summary.unallocated_tax,0)
      assert.equal(result.summary.total_cost,seller.total_cost+unassigned.total_cost+40)
    })
    await check('tax without any paid orders remains general cost, including empty months',async()=>{
      await db.exec("insert into public.financial_monthly_taxes values ('2027-01-01',100.01)")
      const result=await workspace('2027-01-01')
      assert.deepEqual(result.rows,[])
      assert.equal(result.summary.unallocated_tax,100.01)
      assert.equal(result.summary.total_cost,100.01)
      assert.equal(result.summary.confirmed_profit,-100.01)
      assert.equal(result.summary.margin_pct,null)
    })
    await check('zero eligible revenue does not require commission configuration',async()=>{
      await db.exec(`insert into public.seller_financial_settings values ('${bruno}','2026-10-01',0,null);
        insert into public.orders values ('cancelled-only','${bruno}','2026-10-15',100,'After Pay','Cancelado',false,1);`)
      const row=(await workspace()).rows.find(r=>r.seller_id===bruno)
      assert.equal(row.pending.commission,0)
      assert.equal(row.total_cost,0.5)
    })
    await check('authenticated CRUD is validated and anonymous cannot read or execute',async()=>{
      for(const amount of [-1,1.234,'NaN','Infinity',1000000000000]) {
        await assert.rejects(asRole('authenticated',()=>db.query("insert into public.financial_cost_entries(description,amount,cost_date) values ('Expense',$1,'2026-10-01')",[amount])),/check constraint|numeric/i)
        await assert.rejects(asRole('authenticated',()=>db.query("update public.financial_monthly_taxes set tax_paid=$1",[amount])),/check constraint|numeric/i)
      }
      for(const [description,amount] of [['',1],[' '.repeat(3),1],['x'.repeat(201),1],['Expense',0]])
        await assert.rejects(asRole('authenticated',()=>db.query("insert into public.financial_cost_entries(description,amount,cost_date) values ($1,$2,'2026-10-01')",[description,amount])),/check constraint/i)
      await assert.rejects(workspace('2026-10-02'),/first day|month/i)
      await asRole('authenticated',()=>db.exec("update public.financial_monthly_taxes set tax_paid=0; update public.financial_cost_entries set description='Edited'; delete from public.financial_cost_entries; delete from public.financial_monthly_taxes"))
      assert.equal((await workspace()).tax,null)
      await assert.rejects(asRole('anon',()=>db.query("select public.get_financial_workspace('2026-10-01')")),/permission denied/i)
      for(const table of ['financial_monthly_taxes','financial_cost_entries'])
        await assert.rejects(asRole('anon',()=>db.query(`select * from public.${table}`)),/permission denied/i)
    })
  } finally { await db.close() }
})
