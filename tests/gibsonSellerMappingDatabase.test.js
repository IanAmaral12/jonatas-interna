import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const otherSellerId = '22222222-2222-4222-8222-222222222222'

test('Gibson mapping links Skale orders and Meta campaigns', async () => {
  const db = new PGlite()
  try {
    const original = await readFile(
      new URL('../supabase/migrations/20260826200000_create_meta_ads_analytics.sql', import.meta.url),
      'utf8',
    )
    const normalize = original.match(/create or replace function public\.normalize_match_text\([\s\S]*?\$\$;/)?.[0]
    const assign = original.match(/create or replace function public\.assign_order_seller\([\s\S]*?\$\$;/)?.[0]
    const resolve = original.match(/create or replace function public\.resolve_meta_campaign_seller\([\s\S]*?\$\$;/)?.[0]
    assert.ok(normalize && assign && resolve)

    await db.exec(normalize)
    await db.exec(`
      create table public.sellers (
        id uuid primary key default gen_random_uuid(),
        name text not null unique,
        normalized_name text generated always as (public.normalize_match_text(name)) stored,
        active boolean not null default true,
        created_at timestamptz not null default now()
      );
      create table public.seller_aliases (
        id bigint generated always as identity primary key,
        seller_id uuid not null references public.sellers(id),
        alias text not null,
        normalized_alias text generated always as (public.normalize_match_text(alias)) stored,
        unique (normalized_alias)
      );
      create table public.orders (
        id text primary key,
        atendente text,
        seller_id uuid references public.sellers(id),
        cancelado boolean not null default false
      );
      create table public.meta_campaigns (
        id text primary key,
        name text not null,
        normalized_name text generated always as (public.normalize_match_text(name)) stored,
        seller_id uuid references public.sellers(id),
        mapping_source text not null default 'unmatched',
        updated_at timestamptz not null default now()
      );
      insert into public.sellers(id, name) values ('${otherSellerId}', 'Pedro Henrique');
      insert into public.seller_aliases(seller_id, alias) values ('${otherSellerId}', 'Pedro');
    `)
    await db.exec(assign)
    await db.exec(resolve)
    await db.exec(`
      create trigger assign_order_seller_before_write
      before insert or update of atendente on public.orders
      for each row execute function public.assign_order_seller();
      insert into public.orders(id, atendente) values
        ('gibson-order', 'Gibson Victor de Oliveira'),
        ('other-order', 'Pedro');
      insert into public.meta_campaigns(id, name) values
        ('gibson-campaign', 'CP GIBSON - 23/09'),
        ('other-campaign', 'CP PEDRO - 23/09');
    `)

    const migration = await readFile(
      new URL('../supabase/migrations/20260923180000_add_gibson_seller_mapping.sql', import.meta.url),
      'utf8',
    )
    await db.exec(migration)
    await db.exec(migration)

    const { rows: sellers } = await db.query(`
      select sellers.id, sellers.name,
        array_agg(aliases.normalized_alias order by aliases.normalized_alias) as aliases
      from public.sellers as sellers
      join public.seller_aliases as aliases on aliases.seller_id = sellers.id
      where sellers.normalized_name = public.normalize_match_text('Gibson Victor de Oliveira')
      group by sellers.id, sellers.name
    `)
    assert.equal(sellers.length, 1)
    assert.equal(sellers[0].name, 'Gibson Victor de Oliveira')
    assert.deepEqual(sellers[0].aliases, ['GIBSON', 'GIBSON VICTOR DE OLIVEIRA'])

    const gibsonId = sellers[0].id
    const { rows: orders } = await db.query('select id, seller_id from public.orders order by id')
    assert.deepEqual(orders, [
      { id: 'gibson-order', seller_id: gibsonId },
      { id: 'other-order', seller_id: otherSellerId },
    ])

    const { rows: campaigns } = await db.query(
      'select id, seller_id, mapping_source from public.meta_campaigns order by id',
    )
    assert.deepEqual(campaigns, [
      { id: 'gibson-campaign', seller_id: gibsonId, mapping_source: 'auto' },
      { id: 'other-campaign', seller_id: null, mapping_source: 'unmatched' },
    ])

    const { rows: futureOrders } = await db.query(
      "insert into public.orders(id, atendente) values ('future', 'gibson') returning seller_id",
    )
    assert.equal(futureOrders[0].seller_id, gibsonId)

    const { rows: resolved } = await db.query(
      "select * from public.resolve_meta_campaign_seller('NOVO TRAFEGO GIBSON BRASIL')",
    )
    assert.deepEqual(resolved, [{ seller_id: gibsonId, mapping_source: 'auto' }])
  } finally {
    await db.close()
  }
})
