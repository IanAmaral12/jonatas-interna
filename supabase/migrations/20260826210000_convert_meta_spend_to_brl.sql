create table public.meta_exchange_rates (
  rate_date date primary key,
  base_currency text not null default 'USD' check (base_currency = 'USD'),
  quote_currency text not null default 'BRL' check (quote_currency = 'BRL'),
  rate numeric(18, 8) not null check (rate > 0),
  provider text not null default 'BCB',
  source text not null default 'Frankfurter v2',
  fetched_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb
);

alter table public.meta_campaign_hourly_insights
  add column spend_usd numeric(18, 6) check (spend_usd >= 0),
  add column spend_brl numeric(18, 6) check (spend_brl >= 0),
  add column exchange_rate_usd_brl numeric(18, 8) check (exchange_rate_usd_brl > 0),
  add column exchange_rate_date date;

comment on column public.meta_campaign_hourly_insights.spend is
  'Valor original devolvido pela Meta, na moeda da conta de anúncios.';
comment on column public.meta_campaign_hourly_insights.spend_usd is
  'Investimento convertido para USD usando a cotação registrada na linha.';
comment on column public.meta_campaign_hourly_insights.spend_brl is
  'Investimento convertido para BRL e usado nos cálculos do frontend.';
comment on column public.meta_campaign_hourly_insights.exchange_rate_usd_brl is
  'Quantidade de BRL equivalente a 1 USD na taxa de referência utilizada.';

update public.meta_campaign_hourly_insights
set spend_brl = spend
where currency = 'BRL';

create index meta_insights_brl_bucket_idx
  on public.meta_campaign_hourly_insights (bucket_start desc, spend_brl);

create or replace function public.replace_meta_hourly_insights(
  p_account_id text,
  p_metric_date date,
  p_rows jsonb,
  p_fetched_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_timezone text;
  account_currency text;
  inserted_count integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Os insights da Meta devem ser enviados como um array JSON.';
  end if;

  select accounts.timezone_name, accounts.currency
  into account_timezone, account_currency
  from public.meta_ad_accounts as accounts
  where accounts.id = p_account_id
    and accounts.enabled = true;

  if account_timezone is null then
    raise exception 'Conta de anúncios % inexistente ou desabilitada.', p_account_id;
  end if;

  with insight_rows as (
    select *
    from jsonb_to_recordset(p_rows) as rows (
      campaign_id text,
      campaign_name text,
      hour_start smallint,
      hour_bucket text,
      spend numeric,
      spend_usd numeric,
      spend_brl numeric,
      exchange_rate_usd_brl numeric,
      exchange_rate_date date,
      impressions bigint,
      reach bigint,
      clicks bigint,
      inline_link_clicks bigint,
      cpc numeric,
      cpm numeric,
      ctr numeric,
      raw_payload jsonb
    )
  ),
  campaigns as (
    select distinct on (rows.campaign_id)
      rows.campaign_id,
      rows.campaign_name,
      resolved.seller_id,
      resolved.mapping_source
    from insight_rows as rows
    cross join lateral public.resolve_meta_campaign_seller(rows.campaign_name) as resolved
    where nullif(btrim(rows.campaign_id), '') is not null
      and nullif(btrim(rows.campaign_name), '') is not null
    order by rows.campaign_id
  )
  insert into public.meta_campaigns as existing (
    id, ad_account_id, name, seller_id, mapping_source, last_seen_at, updated_at
  )
  select
    campaigns.campaign_id,
    p_account_id,
    campaigns.campaign_name,
    campaigns.seller_id,
    campaigns.mapping_source,
    p_fetched_at,
    p_fetched_at
  from campaigns
  on conflict (id) do update
  set
    ad_account_id = excluded.ad_account_id,
    name = excluded.name,
    seller_id = case
      when existing.mapping_source = 'manual' then existing.seller_id
      else excluded.seller_id
    end,
    mapping_source = case
      when existing.mapping_source = 'manual' then existing.mapping_source
      else excluded.mapping_source
    end,
    last_seen_at = excluded.last_seen_at,
    updated_at = excluded.updated_at;

  delete from public.meta_campaign_hourly_insights
  where ad_account_id = p_account_id
    and metric_date = p_metric_date;

  insert into public.meta_campaign_hourly_insights (
    ad_account_id,
    campaign_id,
    metric_date,
    hour_start,
    hour_bucket,
    bucket_start,
    currency,
    spend,
    spend_usd,
    spend_brl,
    exchange_rate_usd_brl,
    exchange_rate_date,
    impressions,
    reach,
    clicks,
    inline_link_clicks,
    cpc,
    cpm,
    ctr,
    fetched_at,
    raw_payload
  )
  select
    p_account_id,
    rows.campaign_id,
    p_metric_date,
    rows.hour_start,
    rows.hour_bucket,
    make_timestamptz(
      extract(year from p_metric_date)::integer,
      extract(month from p_metric_date)::integer,
      extract(day from p_metric_date)::integer,
      rows.hour_start,
      0,
      0,
      account_timezone
    ),
    account_currency,
    coalesce(rows.spend, 0),
    rows.spend_usd,
    rows.spend_brl,
    rows.exchange_rate_usd_brl,
    rows.exchange_rate_date,
    coalesce(rows.impressions, 0),
    coalesce(rows.reach, 0),
    coalesce(rows.clicks, 0),
    coalesce(rows.inline_link_clicks, 0),
    rows.cpc,
    rows.cpm,
    rows.ctr,
    p_fetched_at,
    coalesce(rows.raw_payload, '{}'::jsonb)
  from jsonb_to_recordset(p_rows) as rows (
    campaign_id text,
    campaign_name text,
    hour_start smallint,
    hour_bucket text,
    spend numeric,
    spend_usd numeric,
    spend_brl numeric,
    exchange_rate_usd_brl numeric,
    exchange_rate_date date,
    impressions bigint,
    reach bigint,
    clicks bigint,
    inline_link_clicks bigint,
    cpc numeric,
    cpm numeric,
    ctr numeric,
    raw_payload jsonb
  )
  where nullif(btrim(rows.campaign_id), '') is not null;

  get diagnostics inserted_count = row_count;

  update public.meta_ad_accounts
  set last_synced_at = p_fetched_at, updated_at = p_fetched_at
  where id = p_account_id;

  return inserted_count;
end;
$$;

create or replace function public.get_cpa_dashboard(
  p_start_date date,
  p_end_date date
)
returns table (
  currency text,
  seller_id uuid,
  seller_name text,
  spend numeric,
  appointments bigint,
  cpa numeric,
  currency_conflict boolean,
  mapping_status text,
  row_type text
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      p_start_date::timestamp at time zone 'America/Sao_Paulo' as starts_at,
      (p_end_date + 1)::timestamp at time zone 'America/Sao_Paulo' as ends_at
  ),
  spend_by_seller as (
    select
      campaigns.seller_id,
      coalesce(sellers.name, 'Não atribuído') as seller_name,
      sum(insights.spend_brl) as spend,
      case when campaigns.seller_id is null then 'unmatched' else 'matched' end as mapping_status
    from public.meta_campaign_hourly_insights as insights
    join public.meta_campaigns as campaigns on campaigns.id = insights.campaign_id
    left join public.sellers as sellers on sellers.id = campaigns.seller_id
    cross join bounds
    where insights.bucket_start >= bounds.starts_at
      and insights.bucket_start < bounds.ends_at
      and insights.spend_brl is not null
    group by campaigns.seller_id, sellers.name
  ),
  order_counts as (
    select orders.seller_id, count(*)::bigint as appointments
    from public.orders as orders
    cross join bounds
    where orders.cancelado = false
      and orders.seller_id is not null
      and orders.data >= bounds.starts_at
      and orders.data < bounds.ends_at
    group by orders.seller_id
  ),
  total_orders as (
    select count(*)::bigint as appointments
    from public.orders as orders
    cross join bounds
    where orders.cancelado = false
      and orders.data >= bounds.starts_at
      and orders.data < bounds.ends_at
  ),
  general_row as (
    select
      'BRL'::text as currency,
      null::uuid as seller_id,
      'Geral'::text as seller_name,
      coalesce(sum(spend_by_seller.spend), 0::numeric) as spend,
      total_orders.appointments,
      case
        when total_orders.appointments > 0
          then round(coalesce(sum(spend_by_seller.spend), 0::numeric) / total_orders.appointments, 2)
      end as cpa,
      false as currency_conflict,
      'general'::text as mapping_status,
      'general'::text as row_type
    from total_orders
    left join spend_by_seller on true
    group by total_orders.appointments
  ),
  seller_rows as (
    select
      'BRL'::text as currency,
      spend.seller_id,
      spend.seller_name,
      spend.spend,
      coalesce(order_counts.appointments, 0) as appointments,
      case
        when coalesce(order_counts.appointments, 0) > 0
          then round(spend.spend / order_counts.appointments, 2)
      end as cpa,
      false as currency_conflict,
      spend.mapping_status,
      case when spend.seller_id is null then 'unmatched' else 'seller' end as row_type
    from spend_by_seller as spend
    left join order_counts on order_counts.seller_id = spend.seller_id
  )
  select * from general_row
  union all
  select * from seller_rows
  order by row_type, cpa nulls last, seller_name;
$$;

alter table public.meta_exchange_rates enable row level security;
revoke all on table public.meta_exchange_rates from public, anon, authenticated;
