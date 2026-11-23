-- The cache stores the unmodified BCB reference; insight rows store reference * 1.07.
create or replace function public.revalue_meta_usd_spend(
  p_start_date date,
  p_end_date date,
  p_rates jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_count integer;
begin
  if p_start_date is null or p_end_date is null
    or p_start_date < date '2026-11-01'
    or p_end_date < p_start_date or p_end_date - p_start_date > 30 then
    raise exception 'Período inválido para recalcular o câmbio.';
  end if;
  if p_rates is null or jsonb_typeof(p_rates) <> 'array' then
    raise exception 'Lista de cotações inválida.';
  end if;
  if jsonb_array_length(p_rates) = 0 or exists (
    select 1 from jsonb_array_elements(p_rates) as item
    where jsonb_typeof(item->'rate') is distinct from 'number'
      or item->>'base' is distinct from 'USD' or item->>'quote' is distinct from 'BRL'
      or item->>'date' is null or item->>'date' !~ '^\d{4}-\d{2}-\d{2}$'
  ) then
    raise exception 'A API retornou uma cotação inválida.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rates) as item
    where (item->>'rate')::numeric <= 0 or (item->>'date')::date > p_end_date
  ) then
    raise exception 'A API retornou uma cotação inválida.';
  end if;

  insert into public.meta_exchange_rates
    (rate_date, base_currency, quote_currency, rate, provider, source, fetched_at, raw_payload)
  select (item->>'date')::date, 'USD', 'BRL', (item->>'rate')::numeric,
    'BCB', 'Frankfurter v2', now(), item
  from jsonb_array_elements(p_rates) as item
  on conflict (rate_date) do update set
    rate = excluded.rate, provider = excluded.provider, source = excluded.source,
    fetched_at = excluded.fetched_at, raw_payload = excluded.raw_payload;

  -- Refuse an incomplete correction instead of assuming a rate for uncovered dates.
  if exists (
    select 1 from public.meta_campaign_hourly_insights as insights
    where insights.currency = 'USD'
      and insights.metric_date between p_start_date and p_end_date
      and not exists (
        select 1 from public.meta_exchange_rates as rates
        where rates.provider = 'BCB' and rates.source = 'Frankfurter v2'
          and rates.rate_date between insights.metric_date - 14 and insights.metric_date
      )
  ) then
    raise exception 'Sem cotação BCB disponível para todos os dias do período.';
  end if;

  with days as (
    select distinct metric_date
    from public.meta_campaign_hourly_insights
    where currency = 'USD' and metric_date between p_start_date and p_end_date
  ), daily_rates as (
    select days.metric_date, rate.rate_date, round(rate.rate * 1.07, 8) effective_rate
    from days
    cross join lateral (
      select rates.rate_date, rates.rate from public.meta_exchange_rates as rates
      where rates.provider = 'BCB' and rates.source = 'Frankfurter v2'
        and rates.rate_date between days.metric_date - 14 and days.metric_date
      order by rates.rate_date desc limit 1
    ) as rate
  )
  update public.meta_campaign_hourly_insights as insights
  set spend_usd = insights.spend,
    spend_brl = round(insights.spend * daily_rates.effective_rate, 6),
    exchange_rate_usd_brl = daily_rates.effective_rate,
    exchange_rate_date = daily_rates.rate_date
  from daily_rates
  where insights.currency = 'USD' and insights.metric_date = daily_rates.metric_date
    and (insights.spend_usd, insights.spend_brl, insights.exchange_rate_usd_brl, insights.exchange_rate_date)
      is distinct from (insights.spend, round(insights.spend * daily_rates.effective_rate, 6),
        daily_rates.effective_rate, daily_rates.rate_date);
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.revalue_meta_usd_spend(date, date, jsonb) from public, anon, authenticated;
grant execute on function public.revalue_meta_usd_spend(date, date, jsonb) to service_role;
