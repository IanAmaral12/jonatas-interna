import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('verified Skale payments repair receipts without inventing fees or replaying old totals', async (t) => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.orders(id text primary key,status_pagamento text,data_pagamento date);
      insert into public.orders values ('partial','Pago Parcial',null),('missing','After Pay',null),('full','Pago',null);
      create schema pgmq;
      create table pgmq.a_orders_ingest(msg_id bigint,enqueued_at timestamptz,message jsonb);`)
    const dir = new URL('../supabase/migrations/', import.meta.url)
    const files = await readdir(dir)
    for (const suffix of ['_order_financial_snapshots.sql','_reconcile_confirmed_order_payments.sql']) {
      const file = files.find(f => f.endsWith(suffix))
      assert.ok(file, `Missing ${suffix}`)
      await db.exec(await readFile(new URL(file, dir), 'utf8'))
    }
    const write = (id,payload,msg,date='2026-10-20T12:00:00Z') => db.query(
      'select public.record_order_financial_snapshot($1,$2,$3,$4)',[id,payload,msg,date])
    const reconcile = (id,status,amount,payments,observed='2026-11-20T12:00:00Z') => db.query(
      'select public.reconcile_confirmed_order_payments($1,$2,$3,$4,$5) id',[id,status,amount,JSON.stringify(payments),observed])
    const row = async id => (await db.query('select * from public.order_financial_snapshots where order_id=$1',[id])).rows[0]
    const paid = (id,amount,status='Pago') => ({ id,status,amount,paid_at:'2026-11-05' })
    await write('partial',{transaction:{payment_status:'Pago Parcial',total_price:49700,affiliate_earned:0}},1)
    await write('missing',{transaction:{payment_status:'After Pay',paid_amount:0,affiliate_earned:0}},2)
    await write('full',{transaction:{payment_status:'Pago',total_price:49700,affiliate_earned:0}},3)
    assert.equal((await row('full')).received_amount,'497.00', 'Existing first-paid fallback remains compatible')

    await t.test('only confirmed legs count and repeated reconciliation replaces rather than adds', async () => {
      const legs=[paid(101,200),paid(102,297,'Aguardando Pagamento'),paid(103,497,'Cancelado')]
      const first=(await reconcile('partial','Pago Parcial',200,legs)).rows[0].id
      assert.equal((await reconcile('partial','Pago Parcial',200,legs)).rows[0].id,first)
      const current=await row('partial')
      assert.equal(current.received_amount,'200.00')
      assert.equal(current.received_amount_source,'skale_payments')
      assert.equal(current.payment_fee,null)
      assert.equal(current.source_message_id,1)
      assert.equal(current.field_versions.received_amount.source,'skale_payments')
      assert.equal((await db.query('select count(*)::int count from public.order_payment_reconciliations')).rows[0].count,1)
    })
    await t.test('missing paid events and misleading full-price fallback are corrected with real receipts', async () => {
      await reconcile('missing','Pago',247,[paid(104,247)])
      assert.equal((await row('missing')).payment_status,'paid')
      assert.equal((await row('missing')).received_payment_status,'paid')
      assert.equal((await row('missing')).received_amount,'247.00')
      assert.deepEqual((await db.query("select status_pagamento,data_pagamento::text paid_date from public.orders where id='missing'")).rows,[{status_pagamento:'Pago',paid_date:'2026-11-05'}])
      await reconcile('full','Pago',248.5,[paid(105,248.5)])
      assert.equal((await row('full')).received_amount,'248.50')
    })
    await t.test('old replay and later gross-price fallback cannot undo verified amounts; newer explicit facts can', async () => {
      await db.exec("update public.orders set status_pagamento='After Pay' where id='full'")
      await write('full',{transaction:{payment_status:'Pago',total_price:49700}},900)
      assert.equal((await row('full')).received_amount,'248.50')
      assert.equal((await db.query("select status_pagamento from public.orders where id='full'")).rows[0].status_pagamento,'Pago')
      await write('full',{transaction:{payment_status:'Pago',total_price:49700}},901,'2026-11-21T12:00:00Z')
      assert.equal((await row('full')).received_amount,'248.50')
      await write('full',{transaction:{payment_status:'Pago',paid_amount:30000}},902,'2026-11-22T12:00:00Z')
      assert.equal((await row('full')).received_amount,'300.00')
      await assert.rejects(reconcile('full','Pago',248.5,[paid(105,248.5)]),/newer|recent/i)
    })
    await t.test('partial-to-paid status changes cannot turn the order total into a confirmed receipt', async () => {
      await write('partial',{transaction:{payment_status:'Pago',total_price:49700}},910,'2026-11-21T12:00:00Z')
      const current=await row('partial')
      assert.equal(current.payment_status,'paid')
      assert.equal(current.received_amount,'200.00')
      assert.equal(current.received_payment_status,'partial')
      assert.equal(current.received_amount_source,'skale_payments')
      await write('partial',{transaction:{payment_status:'Pago',paid_amount:49700}},911,'2026-11-22T12:00:00Z')
      assert.equal((await row('partial')).received_amount,'497.00')
      assert.equal((await row('partial')).received_payment_status,'paid')
    })
    await t.test('invalid, duplicated or reused payment legs and mismatched sums are rejected atomically', async () => {
      await assert.rejects(reconcile('missing','Pago',500,[paid(201,200)]),/sum|total/i)
      await assert.rejects(reconcile('missing','Pago',400,[paid(201,200),paid(201,200)]),/duplicate/i)
      await assert.rejects(reconcile('missing','Pago',200,[paid(101,200)]),/another order/i)
      await assert.rejects(reconcile('missing','After Pay',200,[paid(201,200)]),/status/i)
      await assert.rejects(reconcile('missing','Pago',1.001,[paid(201,1.001)]),/amount|decimal/i)
      await assert.rejects(reconcile('missing','Pago',0,[]),/payment/i)
      await assert.rejects(reconcile('absent','Pago',200,[paid(201,200)]),/not found/i)
      assert.equal((await row('missing')).received_amount,'247.00')
    })
    await t.test('authenticated and anonymous clients cannot alter or read reconciliation evidence', async () => {
      for (const role of ['anon','authenticated']) {
        await db.exec(`set role ${role}`)
        await assert.rejects(reconcile('missing','Pago',247,[paid(104,247)]),/permission denied/i)
        await assert.rejects(db.query('select * from public.order_payment_reconciliations'),/permission denied/i)
        await db.exec('reset role')
      }
      await db.exec('set role service_role')
      await reconcile('missing','Pago',247,[paid(104,247)])
      await db.query('select * from public.order_payment_reconciliations')
      await db.exec('reset role')
    })
  } finally { await db.close() }
})
