import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('Gabbriel mapping attributes historical spend and future campaigns', async () => {
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
      create table public.meta_campaign_hourly_insights (
        campaign_id text not null references public.meta_campaigns(id),
        spend_brl numeric not null
      );
    `)
    await db.exec(assign)
    await db.exec(resolve)
    await db.exec(`
      create trigger assign_order_seller_before_write
      before insert or update of atendente on public.orders
      for each row execute function public.assign_order_seller();
      insert into public.orders(id, atendente) values
        ('historical-order', 'Gabbriel Oliveira da Silva');
      insert into public.meta_campaigns(id, name) values
        ('campaign-1', 'CP GABBRIEL MXCV 28/09'),
        ('campaign-2', 'CP GABBRIEL BLACK MXCV 29/09'),
        ('unrelated', 'CP OUTRO VENDEDOR');
      insert into public.meta_campaign_hourly_insights(campaign_id, spend_brl) values
        ('campaign-1', 140.03),
        ('campaign-2', 321.62),
        ('unrelated', 50);
    `)

    const migration = await readFile(
      new URL('../supabase/migrations/20260929210000_add_gabbriel_seller_mapping.sql', import.meta.url),
      'utf8',
    )
    await db.exec(migration)
    await db.exec(migration)

    const { rows: sellers } = await db.query(`
      select sellers.id, sellers.name,
        array_agg(aliases.normalized_alias order by aliases.normalized_alias) as aliases
      from public.sellers as sellers
      join public.seller_aliases as aliases on aliases.seller_id = sellers.id
      where sellers.normalized_name = public.normalize_match_text('Gabbriel Oliveira da Silva')
      group by sellers.id, sellers.name
    `)
    assert.equal(sellers.length, 1)
    assert.equal(sellers[0].name, 'Gabbriel Oliveira da Silva')
    assert.deepEqual(sellers[0].aliases, ['GABBRIEL', 'GABBRIEL OLIVEIRA DA SILVA'])

    const gabbrielId = sellers[0].id
    const { rows: orders } = await db.query('select seller_id from public.orders')
    assert.equal(orders[0].seller_id, gabbrielId)

    const { rows: campaigns } = await db.query(
      'select id, seller_id, mapping_source from public.meta_campaigns order by id',
    )
    assert.deepEqual(campaigns, [
      { id: 'campaign-1', seller_id: gabbrielId, mapping_source: 'auto' },
      { id: 'campaign-2', seller_id: gabbrielId, mapping_source: 'auto' },
      { id: 'unrelated', seller_id: null, mapping_source: 'unmatched' },
    ])

    const { rows: spend } = await db.query(`
      select count(*)::integer as rows, sum(insights.spend_brl) as spend_brl
      from public.meta_campaign_hourly_insights as insights
      join public.meta_campaigns as campaigns on campaigns.id = insights.campaign_id
      where campaigns.seller_id = $1
    `, [gabbrielId])
    assert.deepEqual(spend, [{ rows: 2, spend_brl: '461.65' }])

    const { rows: futureOrder } = await db.query(
      "insert into public.orders(id, atendente) values ('future-order', 'gabbriel') returning seller_id",
    )
    assert.equal(futureOrder[0].seller_id, gabbrielId)

    const { rows: resolved } = await db.query(
      "select * from public.resolve_meta_campaign_seller('NOVA CAMPANHA GABBRIEL BRASIL')",
    )
    assert.deepEqual(resolved, [{ seller_id: gabbrielId, mapping_source: 'auto' }])
  } finally {
    await db.close()
  }
})
