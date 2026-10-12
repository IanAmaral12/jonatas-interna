import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('dashboard ignores spend from the CA 1 - JC ad account', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create table public.sellers (
        id uuid primary key,
        name text not null
      );
      create table public.meta_ad_accounts (
        id text primary key,
        name text not null
      );
      create table public.meta_campaigns (
        id text primary key,
        seller_id uuid references public.sellers(id)
      );
      create table public.meta_campaign_hourly_insights (
        ad_account_id text not null references public.meta_ad_accounts(id),
        campaign_id text not null references public.meta_campaigns(id),
        bucket_start timestamptz not null,
        spend_brl numeric
      );
      create table public.meta_campaign_daily_actions (
        campaign_id text not null references public.meta_campaigns(id),
        metric_date date not null,
        messaging_conversations_started bigint not null default 0
      );
      create table public.orders (
        seller_id uuid references public.sellers(id),
        cancelado boolean not null default false,
        data timestamptz not null,
        valor numeric not null default 0
      );

      insert into public.sellers (id, name)
      values ('11111111-1111-1111-1111-111111111111', 'Ana');
      insert into public.meta_ad_accounts (id, name) values
        ('ignored-account', ' ca 1 - jc '),
        ('regular-account', 'Conta principal');
      insert into public.meta_campaigns (id, seller_id) values
        ('ignored-campaign', null),
        ('unmatched-campaign', null),
        ('matched-campaign', '11111111-1111-1111-1111-111111111111');
      insert into public.meta_campaign_hourly_insights (
        ad_account_id, campaign_id, bucket_start, spend_brl
      ) values
        ('ignored-account', 'ignored-campaign', '2026-10-12 12:00:00-03', 100),
        ('regular-account', 'unmatched-campaign', '2026-10-12 12:00:00-03', 30),
        ('regular-account', 'matched-campaign', '2026-10-12 12:00:00-03', 50);
    `)

    const migration = await readFile(
      new URL('../supabase/migrations/20261012120000_ignore_ca_1_jc_spend.sql', import.meta.url),
      'utf8',
    )
    const dashboardFunction = migration.match(
      /create or replace function public\.get_cpa_dashboard\([\s\S]*?\n\$\$;/,
    )?.[0]
    assert.ok(dashboardFunction)
    await db.exec(dashboardFunction)

    const { rows } = await db.query(
      "select row_type, seller_name, spend from public.get_cpa_dashboard('2026-10-12', '2026-10-12')",
    )

    assert.deepEqual(rows, [
      { row_type: 'general', seller_name: 'Geral', spend: '80' },
      { row_type: 'seller', seller_name: 'Ana', spend: '50' },
      { row_type: 'unmatched', seller_name: 'Não atribuído', spend: '30' },
    ])
  } finally {
    await db.close()
  }
})
