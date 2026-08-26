create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

create or replace function public.normalize_match_text(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      translate(
        upper(value),
        'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑ',
        'AAAAAEEEEIIIIOOOOOUUUUCN'
      ),
      '[^A-Z0-9]+',
      ' ',
      'g'
    )
  );
$$;

create table public.sellers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  normalized_name text generated always as (public.normalize_match_text(name)) stored,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.seller_aliases (
  id bigint generated always as identity primary key,
  seller_id uuid not null references public.sellers (id) on delete cascade,
  alias text not null check (btrim(alias) <> ''),
  normalized_alias text generated always as (public.normalize_match_text(alias)) stored,
  created_at timestamptz not null default now(),
  unique (normalized_alias)
);

insert into public.sellers (name)
values
  ('Pedro Henrique da Costa'),
  ('Evellyn Cristina Silva Souza'),
  ('William Ferreira'),
  ('João Vitor Faustino da Cruz'),
  ('Anderson Lins de Oliveira'),
  ('Murilo Almeida dos Santos Borges')
on conflict (name) do nothing;

with aliases (seller_name, alias) as (
  values
    ('Pedro Henrique da Costa', 'Pedro Henrique da Costa'),
    ('Pedro Henrique da Costa', 'Pedro Henrique'),
    ('Pedro Henrique da Costa', 'Pedro'),
    ('Evellyn Cristina Silva Souza', 'Evellyn Cristina Silva Souza'),
    ('Evellyn Cristina Silva Souza', 'Evellyn'),
    ('Evellyn Cristina Silva Souza', 'Evelyn'),
    ('William Ferreira', 'William Ferreira'),
    ('William Ferreira', 'William'),
    ('William Ferreira', 'Will'),
    ('João Vitor Faustino da Cruz', 'João Vitor Faustino da Cruz'),
    ('João Vitor Faustino da Cruz', 'João Vitor'),
    ('João Vitor Faustino da Cruz', 'João'),
    ('Anderson Lins de Oliveira', 'Anderson Lins de Oliveira'),
    ('Anderson Lins de Oliveira', 'Anderson'),
    ('Murilo Almeida dos Santos Borges', 'Murilo Almeida dos Santos Borges'),
    ('Murilo Almeida dos Santos Borges', 'Murilo'),
    ('Murilo Almeida dos Santos Borges', 'Murillo')
)
insert into public.seller_aliases (seller_id, alias)
select sellers.id, aliases.alias
from aliases
join public.sellers as sellers on sellers.name = aliases.seller_name
on conflict (normalized_alias) do nothing;

alter table public.orders
  add column seller_id uuid references public.sellers (id) on delete set null;

create or replace function public.assign_order_seller()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.atendente is null then
    new.seller_id := null;
    return new;
  end if;

  select aliases.seller_id
  into new.seller_id
  from public.seller_aliases as aliases
  where aliases.normalized_alias = public.normalize_match_text(new.atendente)
  limit 1;

  return new;
end;
$$;

create trigger assign_order_seller_before_write
before insert or update of atendente on public.orders
for each row execute function public.assign_order_seller();

update public.orders
set atendente = atendente
where atendente is not null;

create index orders_seller_data_cpa_idx
  on public.orders (seller_id, data desc)
  where cancelado = false;

create table public.meta_ad_accounts (
  id text primary key check (btrim(id) <> ''),
  account_id text not null,
  token_slot smallint not null check (token_slot in (1, 2)),
  name text not null,
  currency text not null check (currency in ('BRL', 'USD')),
  timezone_name text not null,
  timezone_offset_hours_utc numeric(6, 2),
  account_status integer,
  enabled boolean not null default true,
  discovered_at timestamptz not null default now(),
  last_synced_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.meta_campaigns (
  id text primary key check (btrim(id) <> ''),
  ad_account_id text not null references public.meta_ad_accounts (id) on delete cascade,
  name text not null,
  normalized_name text generated always as (public.normalize_match_text(name)) stored,
  seller_id uuid references public.sellers (id) on delete set null,
  mapping_source text not null default 'unmatched'
    check (mapping_source in ('auto', 'manual', 'unmatched', 'ambiguous')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.meta_campaign_hourly_insights (
  ad_account_id text not null references public.meta_ad_accounts (id) on delete cascade,
  campaign_id text not null references public.meta_campaigns (id) on delete cascade,
  metric_date date not null,
  hour_start smallint not null check (hour_start between 0 and 23),
  hour_bucket text not null,
  bucket_start timestamptz not null,
  currency text not null check (currency in ('BRL', 'USD')),
  spend numeric(18, 6) not null default 0 check (spend >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  reach bigint not null default 0 check (reach >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  inline_link_clicks bigint not null default 0 check (inline_link_clicks >= 0),
  cpc numeric(18, 8),
  cpm numeric(18, 8),
  ctr numeric(18, 8),
  fetched_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb,
  primary key (ad_account_id, campaign_id, metric_date, hour_start)
);

create table public.meta_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'completed', 'partial', 'failed', 'skipped')),
  accounts_discovered integer not null default 0,
  accounts_synced integer not null default 0,
  rows_received integer not null default 0,
  error_details jsonb not null default '[]'::jsonb
);

create index meta_insights_bucket_idx
  on public.meta_campaign_hourly_insights (bucket_start desc, currency);
create index meta_campaigns_seller_idx
  on public.meta_campaigns (seller_id);
create index meta_accounts_token_slot_idx
  on public.meta_ad_accounts (token_slot)
  where enabled = true;

create or replace function public.resolve_meta_campaign_seller(campaign_name text)
returns table (seller_id uuid, mapping_source text)
language sql
stable
security definer
set search_path = ''
as $$
  with matches as (
    select distinct aliases.seller_id
    from public.seller_aliases as aliases
    where position(
      aliases.normalized_alias in public.normalize_match_text(campaign_name)
    ) > 0
  ),
  summary as (
    select count(*) as match_count, min(matches.seller_id::text)::uuid as matched_seller
    from matches
  )
  select
    case when summary.match_count = 1 then summary.matched_seller end,
    case
      when summary.match_count = 1 then 'auto'
      when summary.match_count > 1 then 'ambiguous'
      else 'unmatched'
    end
  from summary;
$$;

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
    id,
    ad_account_id,
    name,
    seller_id,
    mapping_source,
    last_seen_at,
    updated_at
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
  mapping_status text
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
      insights.currency,
      campaigns.seller_id,
      coalesce(sellers.name, 'Não atribuído') as seller_name,
      sum(insights.spend) as spend,
      case when campaigns.seller_id is null then 'unmatched' else 'matched' end as mapping_status
    from public.meta_campaign_hourly_insights as insights
    join public.meta_campaigns as campaigns on campaigns.id = insights.campaign_id
    left join public.sellers as sellers on sellers.id = campaigns.seller_id
    cross join bounds
    where insights.bucket_start >= bounds.starts_at
      and insights.bucket_start < bounds.ends_at
    group by insights.currency, campaigns.seller_id, sellers.name
  ),
  currency_counts as (
    select spend.seller_id, count(distinct spend.currency) as currency_count
    from spend_by_seller as spend
    where spend.seller_id is not null
    group by spend.seller_id
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
  )
  select
    spend.currency,
    spend.seller_id,
    spend.seller_name,
    spend.spend,
    case
      when coalesce(currency_counts.currency_count, 0) <= 1
        then coalesce(order_counts.appointments, 0)
      else 0
    end as appointments,
    case
      when coalesce(currency_counts.currency_count, 0) <= 1
        and coalesce(order_counts.appointments, 0) > 0
        then round(spend.spend / order_counts.appointments, 2)
    end as cpa,
    coalesce(currency_counts.currency_count, 0) > 1 as currency_conflict,
    spend.mapping_status
  from spend_by_seller as spend
  left join currency_counts on currency_counts.seller_id = spend.seller_id
  left join order_counts on order_counts.seller_id = spend.seller_id
  order by spend.currency, cpa nulls last, spend.seller_name;
$$;

create table public.meta_ads_worker_lease (
  singleton boolean primary key default true check (singleton),
  owner_token uuid,
  locked_until timestamptz not null default '-infinity'::timestamptz
);

insert into public.meta_ads_worker_lease (singleton)
values (true)
on conflict (singleton) do nothing;

create or replace function public.claim_meta_ads_worker(
  requested_owner uuid,
  lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean;
begin
  update public.meta_ads_worker_lease
  set
    owner_token = requested_owner,
    locked_until = now() + make_interval(secs => least(greatest(lease_seconds, 60), 900))
  where singleton = true
    and locked_until <= now()
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

create or replace function public.release_meta_ads_worker(requested_owner uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  released boolean;
begin
  update public.meta_ads_worker_lease
  set owner_token = null, locked_until = '-infinity'::timestamptz
  where singleton = true
    and owner_token = requested_owner
  returning true into released;

  return coalesce(released, false);
end;
$$;

create or replace function public.invoke_meta_ads_sync()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_secret text;
  request_id bigint;
begin
  select decrypted_secret
  into worker_secret
  from vault.decrypted_secrets
  where name = 'meta_ads_worker_secret'
  limit 1;

  if worker_secret is null then
    raise exception 'O segredo meta_ads_worker_secret não foi configurado no Vault.';
  end if;

  select net.http_post(
    url := 'https://biyzmqfpxeqkittmnxpu.supabase.co/functions/v1/meta-ads-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', worker_secret
    ),
    body := jsonb_build_object('mode', 'sync'),
    timeout_milliseconds := 30000
  )
  into request_id;

  return request_id;
end;
$$;

create or replace function public.configure_meta_ads_schedule(secret_value text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_secret_id uuid;
begin
  if secret_value is null or length(secret_value) < 32 then
    raise exception 'O segredo do worker deve ter pelo menos 32 caracteres.';
  end if;

  select id
  into existing_secret_id
  from vault.decrypted_secrets
  where name = 'meta_ads_worker_secret'
  limit 1;

  if existing_secret_id is null then
    perform vault.create_secret(
      secret_value,
      'meta_ads_worker_secret',
      'Segredo usado pelo Cron para invocar a sincronização de anúncios da Meta.'
    );
  else
    perform vault.update_secret(
      existing_secret_id,
      secret_value,
      'meta_ads_worker_secret',
      'Segredo usado pelo Cron para invocar a sincronização de anúncios da Meta.'
    );
  end if;

  perform cron.schedule(
    'sync-meta-ads-insights',
    '*/10 * * * *',
    'select public.invoke_meta_ads_sync();'
  );

  return true;
end;
$$;

alter table public.sellers enable row level security;
alter table public.seller_aliases enable row level security;
alter table public.meta_ad_accounts enable row level security;
alter table public.meta_campaigns enable row level security;
alter table public.meta_campaign_hourly_insights enable row level security;
alter table public.meta_sync_runs enable row level security;
alter table public.meta_ads_worker_lease enable row level security;

revoke all on table public.sellers from public, anon, authenticated;
revoke all on table public.seller_aliases from public, anon, authenticated;
revoke all on table public.meta_ad_accounts from public, anon, authenticated;
revoke all on table public.meta_campaigns from public, anon, authenticated;
revoke all on table public.meta_campaign_hourly_insights from public, anon, authenticated;
revoke all on table public.meta_sync_runs from public, anon, authenticated;
revoke all on table public.meta_ads_worker_lease from public, anon, authenticated;

revoke all on function public.resolve_meta_campaign_seller(text) from public, anon, authenticated;
revoke all on function public.replace_meta_hourly_insights(text, date, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.get_cpa_dashboard(date, date) from public, anon, authenticated;
revoke all on function public.assign_order_seller() from public, anon, authenticated;
revoke all on function public.claim_meta_ads_worker(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_meta_ads_worker(uuid) from public, anon, authenticated;
revoke all on function public.invoke_meta_ads_sync() from public, anon, authenticated;
revoke all on function public.configure_meta_ads_schedule(text) from public, anon, authenticated;

grant execute on function public.resolve_meta_campaign_seller(text) to service_role;
grant execute on function public.replace_meta_hourly_insights(text, date, jsonb, timestamptz) to service_role;
grant execute on function public.claim_meta_ads_worker(uuid, integer) to service_role;
grant execute on function public.release_meta_ads_worker(uuid) to service_role;
grant execute on function public.configure_meta_ads_schedule(text) to service_role;
grant execute on function public.get_cpa_dashboard(date, date) to authenticated;
