import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('migration restores units from creation events then later events', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create schema pgmq;
      create table pgmq.a_orders_ingest (msg_id bigint primary key, message jsonb not null);
      create table public.orders (id text primary key);
      insert into public.orders(id) values ('created'), ('later-only'), ('unknown');
      insert into pgmq.a_orders_ingest(msg_id,message) values
        (1, '{"payload":{"status":"order_created","skaletracking":{"id_venda":"created"},"product":{"products":[{"quantity":2},{"quantity":"3"}]}}}'),
        (2, '{"payload":{"status":"after_pay","skaletracking":{"id_venda":"created"},"product":{"products":[{"quantity":9}]}}}'),
        (3, '{"payload":{"status":"after_pay","skaletracking":{"id_venda":"later-only"},"product":{"products":[{"quantity":4}]}}}'),
        (4, '{"payload":{"status":"order_created","skaletracking":{"id_venda":"unknown"},"product":{"products":[{"quantity":0}]}}}');
    `)
    const filenames = await readdir(new URL('../supabase/migrations/', import.meta.url))
    const migrationName = filenames.find((name) => name.endsWith('_add_order_product_units.sql'))
    assert.ok(migrationName, 'order units migration exists')
    const migration = await readFile(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8')
    await db.exec(migration)

    const { rows } = await db.query('select id, product_units from public.orders order by id')
    assert.deepEqual(rows, [
      { id: 'created', product_units: 5 },
      { id: 'later-only', product_units: 4 },
      { id: 'unknown', product_units: null },
    ])
    await assert.rejects(db.query("update public.orders set product_units = 0 where id = 'created'"),
      /check constraint/i)
  } finally {
    await db.close()
  }
})
