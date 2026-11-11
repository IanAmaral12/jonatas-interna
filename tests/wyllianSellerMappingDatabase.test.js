import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('Wyllian receives historical and future metrics without changing manual campaign mappings', async () => {
  const db = new PGlite()
  try {
    const original = await readFile(
      new URL('../supabase/migrations/20260826200000_create_meta_ads_analytics.sql', import.meta.url),
      'utf8',
    )
    const definitions = Object.fromEntries(
      ['normalize_match_text', 'assign_order_seller', 'resolve_meta_campaign_seller'].map((name) => [
        name,
        original.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0],
      ]),
    )
    for (const [name, definition] of Object.entries(definitions)) assert.ok(definition, `Missing ${name}`)
    await db.exec(definitions.normalize_match_text)
    await db.exec(`
      create table public.sellers (
        id uuid primary key default gen_random_uuid(), name text not null unique,
        normalized_name text generated always as (public.normalize_match_text(name)) stored,
        created_at timestamptz not null default now()
      );
      create table public.seller_aliases (
        seller_id uuid not null references public.sellers(id), alias text not null,
        normalized_alias text generated always as (public.normalize_match_text(alias)) stored,
        unique (normalized_alias)
      );
      create table public.orders (
        id text primary key, atendente text, seller_id uuid references public.sellers(id)
      );
      create table public.meta_campaigns (
        id text primary key, name text not null,
        normalized_name text generated always as (public.normalize_match_text(name)) stored,
        seller_id uuid references public.sellers(id),
        mapping_source text not null default 'unmatched',
        updated_at timestamptz not null default now()
      );
      create table public.meta_campaign_hourly_insights (
        campaign_id text references public.meta_campaigns(id), spend_brl numeric not null
      );
      create table public.meta_campaign_daily_actions (
        campaign_id text references public.meta_campaigns(id), messaging_conversations_started bigint not null
      );
    `)
    await db.exec(definitions.assign_order_seller)
    await db.exec(definitions.resolve_meta_campaign_seller)
    await db.exec(`
      create trigger assign_order_seller_before_write
      before insert or update of atendente on public.orders
      for each row execute function public.assign_order_seller();
      insert into public.sellers(name) values ('William Ferreira');
      insert into public.seller_aliases(seller_id, alias)
      select id, 'William' from public.sellers where name = 'William Ferreira';
      insert into public.orders(id, atendente) values
        ('old-wyllian', 'Wyllian Cristhian da Silva'),
        ('old-william', 'William');
      insert into public.meta_campaigns(id, name, mapping_source, seller_id) values
        ('wyllian', 'CP WYLLIAN MXCP 30/10', 'unmatched', null),
        ('manual', 'CP WYLLIAN MANUAL', 'manual', (select id from public.sellers where name = 'William Ferreira')),
        ('william', 'CP WILLIAM MXCP', 'unmatched', null);
      insert into public.meta_campaign_hourly_insights values ('wyllian', 875.31), ('william', 50);
      insert into public.meta_campaign_daily_actions values ('wyllian', 97), ('william', 5);
    `)

    const migration = await readFile(
      new URL('../supabase/migrations/20261102165633_add_wyllian_seller_mapping.sql', import.meta.url),
      'utf8',
    )
    await db.exec(migration)
    await db.exec(migration)

    const { rows: sellers } = await db.query("select id from public.sellers where name = 'Wyllian Cristhian da Silva'")
    assert.equal(sellers.length, 1)
    const wyllianId = sellers[0].id
    const { rows: orders } = await db.query("select seller_id from public.orders where id = 'old-wyllian'")
    assert.equal(orders[0].seller_id, wyllianId)
    const { rows: metrics } = await db.query(`
      select c.seller_id, c.mapping_source, sum(i.spend_brl) as spend,
        max(a.messaging_conversations_started)::integer as conversations
      from public.meta_campaigns c
      join public.meta_campaign_hourly_insights i on i.campaign_id = c.id
      join public.meta_campaign_daily_actions a on a.campaign_id = c.id
      where c.id = 'wyllian' group by c.seller_id, c.mapping_source
    `)
    assert.deepEqual(metrics, [{ seller_id: wyllianId, mapping_source: 'auto', spend: '875.31', conversations: 97 }])
    const { rows: manual } = await db.query("select seller_id, mapping_source from public.meta_campaigns where id = 'manual'")
    assert.equal(manual[0].mapping_source, 'manual')
    assert.notEqual(manual[0].seller_id, wyllianId)
    const { rows: futureOrder } = await db.query("insert into public.orders(id, atendente) values ('new-wyllian', 'Wyllian') returning seller_id")
    assert.equal(futureOrder[0].seller_id, wyllianId)
    const { rows: futureCampaign } = await db.query("select * from public.resolve_meta_campaign_seller('NOVA CAMPANHA WYLLIAN')")
    assert.deepEqual(futureCampaign, [{ seller_id: wyllianId, mapping_source: 'auto' }])
  } finally {
    await db.close()
  }
})
