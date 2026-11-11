import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { randomUUID } from 'node:crypto'
import { sumProductUnits } from '../supabase/functions/orders-worker/order-units.js'

test('financial snapshots parse cents, merge versions, backfill and restrict access', async (t) => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.orders(id text primary key);
      insert into public.orders values ('one'),('partial'),('zero'),('history'),('empty'),('backfill'),('tie');
      create schema pgmq;
      create table pgmq.a_orders_ingest(msg_id bigint, enqueued_at timestamptz, message jsonb);
      insert into pgmq.a_orders_ingest values (1,'2026-10-20',
        '{"received_at":"malformed","payload":{"type":"order","skaletracking":{"id_venda":"backfill"},"transaction":{"payment_status":"Pago","paid_amount":44700}}}');
      set time zone 'UTC';`)
    const files = await readdir(new URL('../supabase/migrations/', import.meta.url))
    const name = files.find(f => f.endsWith('_order_financial_snapshots.sql'))
    assert.ok(name, 'snapshot migration exists')
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
    const write = (id, payload, msg, date = '2026-10-20T12:00:00Z') => db.query(
      'select public.record_order_financial_snapshot($1,$2,$3,$4)', [id, payload, msg, date])
    const row = async id => (await db.query('select * from public.order_financial_snapshots where order_id=$1', [id])).rows[0]

    await t.test('migration backfills existing archive with safe malformed receipt fallback', async () => {
      assert.equal((await row('backfill')).received_amount,'447.00')
    })

    await t.test('created orders without payment data are valid snapshots', async () => {
      await write('empty', {}, 1)
      assert.equal((await row('empty')).has_payment_evidence, false)
    })

    await t.test('explicit receipts beat total and duplicate events do not add', async () => {
      const payload = { skale: { status_pagamento: ' Pago ' }, transaction: { paid_amount: 30000, total_price: 44700, acquirer_cost: 2231, affiliate_earned: 0 } }
      await write('one', payload, 1)
      await write('one', payload, 1)
      assert.equal((await row('one')).received_amount, '300.00')
      assert.equal((await row('one')).payment_fee, '22.31')
      await write('one', { skale: { status_pagamento: 'Pago' }, transaction: { total_price: 44700 } }, 2)
      assert.equal((await row('one')).received_amount, '300.00')
      await write('zero', { transaction: { payment_status: 'Pago', total_price: 44700, producer_earned: 0, affiliate_earned: 0 } }, 3)
      assert.equal((await row('zero')).received_amount, '447.00')
      assert.equal((await row('zero')).payment_fee, null)
    })
    await t.test('partial missing actual, invalid cents, null and explicit zero stay distinct', async () => {
      await write('partial', { skale: { status_pagamento: 'pago_parcial' }, transaction: { payment_status: 'Pago', total_price: 44700 } }, 1)
      assert.equal((await row('partial')).payment_status, 'partial')
      assert.equal((await row('partial')).received_amount, null)
      for (const amount of [-1, 1.5, '', 'oops', null, true]) {
        await write('partial', { skale: { status_pagamento: 'Parcial' }, transaction: { paid_amount: amount, acquirer_cost: amount } }, 2)
        assert.equal((await row('partial')).received_amount, null)
        assert.equal((await row('partial')).payment_fee, null)
      }
      await write('partial', { transaction: { payment_status: 'Pago Parcial', paid_amount: 0, acquirer_cost: 0, affiliate_earned: 0 } }, 3)
      assert.equal((await row('partial')).received_amount, '0.00')
      assert.equal((await row('partial')).payment_fee, '0.00')
    })
    await t.test('older state, logistics and fallback cannot regress financial facts', async () => {
      await write('history', { updated_at: '2026-10-22T12:00:00Z', skale: { status_pagamento: 'Pago' }, skaletracking: { status_entrega: 'Devolvido' }, transaction: { paid_amount: 30000 } }, 10)
      await write('history', { updated_at: '2026-10-21T12:00:00Z', skale: { status_pagamento: 'Parcial' }, skaletracking: { status_entrega: 'Em trânsito' }, transaction: { paid_amount: 20000, acquirer_cost: 123 } }, 99)
      let current = await row('history')
      assert.equal(current.payment_status, 'paid')
      assert.equal(current.shipping_status, 'Devolvido')
      assert.equal(current.received_amount, '300.00')
      assert.equal(current.payment_fee, '1.23')
      await write('history', { updated_at: 'bad date', skaletracking: { status_entrega: null }, transaction: { paid_amount: null } }, 100, '2026-10-23T12:00:00Z')
      assert.equal((await row('history')).received_amount, '300.00')
      await write('history', { updated_at: '2026-10-24T12:00:00Z', transaction: { payment_status: 'Estornado' } }, 101)
      current = await row('history')
      assert.equal(current.payment_status, 'estornado')
      assert.equal(current.payment_fee, '1.23')
      await write('history', { updated_at: '2026-10-22T12:00:00Z', transaction: { payment_status: 'Pago', paid_amount: 99999 } }, 102)
      assert.equal((await row('history')).payment_status, 'estornado')
    })
    await t.test('archive uses original payload, skips tests/unknown orders and supports tail', async () => {
      await db.query(`insert into pgmq.a_orders_ingest values
        (200,'2026-10-25', $1),(201,'2026-10-26',$2),(202,'2026-10-26',$3)`, [
        { payload: { type: 'order', skaletracking: { id_venda: 'partial' }, transaction: { payment_status: 'Pago', paid_amount: 44700 } } },
        { payload: { type: 'order', _test: true, skaletracking: { id_venda: 'partial' }, transaction: { payment_status: 'Estornado' } } },
        { payload: { type: 'order', skaletracking: { id_venda: 'unknown' } } },
      ])
      await db.query('select public.reconcile_order_financial_snapshots(199)')
      assert.equal((await row('partial')).payment_status, 'paid')
      assert.equal((await row('partial')).received_amount, '447.00')
      assert.equal((await db.query('select count(*) from pgmq.a_orders_ingest')).rows[0].count, 4)
    })
    await t.test('equal timestamps use message id and older facts only fill eligible gaps',async()=>{
      const at='2026-10-22T12:00:00Z'
      await write('tie',{updated_at:at,transaction:{payment_status:'Pago',total_price:44700,acquirer_cost:200}},10)
      await write('tie',{updated_at:at,transaction:{payment_status:'Parcial',paid_amount:10000,acquirer_cost:100}},9)
      assert.equal((await row('tie')).payment_status,'paid')
      assert.equal((await row('tie')).received_amount,'447.00')
      assert.equal((await row('tie')).payment_fee,'2.00')
      await write('tie',{updated_at:at,transaction:{payment_status:'Parcial'}},11)
      await write('tie',{updated_at:'2026-10-21T12:00:00Z',transaction:{payment_status:'Pago',paid_amount:99900}},12)
      assert.equal((await row('tie')).received_payment_status,'paid')
      await write('tie',{updated_at:'2026-10-21T12:00:00Z',transaction:{payment_status:'Parcial',paid_amount:10000}},13)
      assert.equal((await row('tie')).payment_status,'partial')
      assert.equal((await row('tie')).received_payment_status,'partial')
      assert.equal((await row('tie')).received_amount,'100.00')
    })
    await t.test('source priority, local timestamps and split timestamp fields use Sao Paulo', async () => {
      await write('empty', { updated_at:'2026-10-22T12:00:00Z', transaction:{updated_at:'2026-12-01T12:00:00Z',payment_status:'Pago',paid_amount:10000}, skaletracking:{plataforma:'Skale'} }, 10)
      let current=await row('empty')
      assert.equal(new Date(current.source_updated_at).toISOString(),'2026-10-22T12:00:00.000Z')
      assert.equal(current.payment_platform,'Skale')
      await write('empty', { updated_at:'2026-10-22 10:00:00', transaction:{payment_status:'Parcial',paid_amount:5000} }, 11)
      current=await row('empty')
      assert.equal(new Date(current.source_updated_at).toISOString(),'2026-10-22T13:00:00.000Z')
      assert.equal(current.payment_status,'partial')
      await write('empty', { updated_at:'malformed',updated_at_data:'2026-10-22',updated_at_hora:'11:00:00',transaction:{updated_at:'2026-12-01T12:00:00Z',payment_status:'Pago',paid_amount:20000} }, 12)
      assert.equal(new Date((await row('empty')).source_updated_at).toISOString(),'2026-10-22T14:00:00.000Z')
    })
    await t.test('only service role can access snapshots and write/reconcile', async () => {
      for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`)
        await assert.rejects(db.query('select * from public.order_financial_snapshots'), /permission denied/i)
        await assert.rejects(write('one', {}, 999), /permission denied/i)
        await assert.rejects(db.query('select public.reconcile_order_financial_snapshots()'), /permission denied/i)
        await db.exec('reset role')
      }
      await db.exec('set role service_role')
      await write('one', {}, 999)
      await db.query('select * from public.order_financial_snapshots')
      await db.query('select public.reconcile_order_financial_snapshots()')
      await db.exec('reset role')
    })
  } finally { await db.close() }
})

test('worker snapshots created, duplicate and updated orders before archive; failures retry', async () => {
  const source = await readFile(new URL('../supabase/functions/orders-worker/index.ts', import.meta.url), 'utf8')
  const executable = stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, ''))
  for (const scenario of ['created','duplicate','updated','writer failure']) {
    const calls=[]; let handler
    const payload={type:'order',status:scenario==='updated'?'order_updated':'order_created',started_at:'2026-10-15T12:00:00-03:00',skaletracking:{id_venda:'one'},transaction:{payment_status:'Pago',paid_amount:44700}}
    const message={msg_id:42,read_ct:1,enqueued_at:'2026-10-20T12:00:00Z',message:{payload}}
    if(scenario!=='updated') message.message.received_at='2026-10-20T11:00:00Z'
    const client={
      rpc:async(name,args)=>{
        calls.push({name,args})
        if(name==='read_orders_ingest_payloads')return {data:[message]}
        if(name==='record_order_financial_snapshot' && scenario==='writer failure')return {error:{message:'temporary snapshot failure'}}
        return {data:true}
      },
      from:()=>({insert:async()=>({error:scenario==='duplicate'?{code:'23505'}:null}),
        update:()=>({eq:()=>({select:async()=>({data:[{id:'one'}]})})})}),
    }
    runInNewContext(executable,{Deno:{env:{get:()=> 'synthetic-test-value'},serve:fn=>{handler=fn}},
      createClient:()=>client,sumProductUnits,TextEncoder,Response,crypto:{randomUUID},console:{error:()=>{}}})
    const response=await handler(new Request('https://worker.invalid',{method:'POST',headers:{'x-worker-secret':'synthetic-test-value'},body:'{}'}))
    const writer=calls.find(c=>c.name==='record_order_financial_snapshot')
    assert.ok(writer,`${scenario}: snapshot writer called`)
    assert.equal(writer.args.p_order_id,'one')
    assert.equal(JSON.stringify(writer.args.p_payload),JSON.stringify(payload))
    assert.equal(writer.args.p_message_id,42)
    assert.equal(writer.args.p_received_at,message.message.received_at||message.enqueued_at)
    const archive=calls.findIndex(c=>c.name==='archive_orders_ingest_payload')
    if(scenario==='writer failure') { assert.equal(response.status,207); assert.equal(archive,-1) }
    else { assert.equal(response.status,200); assert.ok(archive>calls.indexOf(writer)) }
  }
})
