import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const wesleyId = '11111111-1111-4111-8111-111111111111'
const pedroId = '22222222-2222-4222-8222-222222222222'

test('new Wesley name links historical and future orders to seller metrics', async () => {
  const db = new PGlite()
  try {
    const original = await readFile(
      new URL('../supabase/migrations/20260826200000_create_meta_ads_analytics.sql', import.meta.url),
      'utf8',
    )
    const normalize = original.match(/create or replace function public\.normalize_match_text\([\s\S]*?\$\$;/)?.[0]
    const assign = original.match(/create or replace function public\.assign_order_seller\([\s\S]*?\$\$;/)?.[0]
    assert.ok(normalize && assign)
    await db.exec(normalize)
    await db.exec(`
      create table public.sellers (
        id uuid primary key, name text not null, created_at timestamptz default now()
      );
      create table public.seller_aliases (
        seller_id uuid not null references public.sellers(id), alias text not null,
        normalized_alias text generated always as (public.normalize_match_text(alias)) stored,
        unique (normalized_alias)
      );
      create table public.orders (
        id text primary key, atendente text, seller_id uuid references public.sellers(id),
        cancelado boolean not null default false
      );
      insert into public.sellers(id, name) values
        ('${wesleyId}', 'Wesley Mele de Medeiros'), ('${pedroId}', 'Pedro Henrique da Costa');
      insert into public.seller_aliases(seller_id, alias) values
        ('${wesleyId}', 'Wesley'),
        ('${wesleyId}', 'WESLEY MELE DE MEDEIROS'),
        ('${pedroId}', 'Pedro');
    `)
    await db.exec(assign)
    await db.exec(`
      create trigger assign_order_seller_before_write
      before insert or update of atendente on public.orders
      for each row execute function public.assign_order_seller();
      insert into public.orders(id, atendente) values
        ('old', 'WESLEY MELE DE MEDEIROS'),
        ('new-1', 'WESLEY MEDEIROS'),
        ('new-2', 'WESLEY MEDEIROS'),
        ('other', 'Pedro');
    `)
    assert.equal(
      Number((await db.query("select count(*) as n from public.orders where atendente = 'WESLEY MEDEIROS' and seller_id is null")).rows[0].n),
      2,
    )

    const migration = await readFile(
      new URL('../supabase/migrations/20260921100000_link_wesley_medeiros_orders.sql', import.meta.url),
      'utf8',
    )
    await db.exec(migration)
    await db.exec(migration)
    await db.exec(`insert into public.orders(id, atendente) values
      ('future', 'wesley-medeiros'), ('unknown', 'Another Seller')`)

    const { rows } = await db.query('select id, seller_id from public.orders order by id')
    assert.deepEqual(rows, [
      { id: 'future', seller_id: wesleyId },
      { id: 'new-1', seller_id: wesleyId },
      { id: 'new-2', seller_id: wesleyId },
      { id: 'old', seller_id: wesleyId },
      { id: 'other', seller_id: pedroId },
      { id: 'unknown', seller_id: null },
    ])
    const { rows: metrics } = await db.query(
      'select seller_id, count(*)::integer as orders from public.orders where seller_id is not null group by seller_id order by seller_id',
    )
    assert.deepEqual(metrics, [
      { seller_id: wesleyId, orders: 4 },
      { seller_id: pedroId, orders: 1 },
    ])
  } finally {
    await db.close()
  }
})
