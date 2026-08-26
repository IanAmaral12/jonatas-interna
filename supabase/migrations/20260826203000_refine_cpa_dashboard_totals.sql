drop function public.get_cpa_dashboard(date, date);

create function public.get_cpa_dashboard(
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
  currencies(currency) as (
    values ('BRL'::text), ('USD'::text)
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
  spend_totals as (
    select spend.currency, sum(spend.spend) as spend
    from spend_by_seller as spend
    group by spend.currency
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
  ),
  total_orders as (
    select count(*)::bigint as appointments
    from public.orders as orders
    cross join bounds
    where orders.cancelado = false
      and orders.data >= bounds.starts_at
      and orders.data < bounds.ends_at
  ),
  general_rows as (
    select
      currencies.currency,
      null::uuid as seller_id,
      'Geral'::text as seller_name,
      coalesce(spend_totals.spend, 0::numeric) as spend,
      total_orders.appointments,
      case
        when total_orders.appointments > 0
          then round(coalesce(spend_totals.spend, 0::numeric) / total_orders.appointments, 2)
      end as cpa,
      false as currency_conflict,
      'general'::text as mapping_status,
      'general'::text as row_type
    from currencies
    left join spend_totals on spend_totals.currency = currencies.currency
    cross join total_orders
  ),
  seller_rows as (
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
      spend.mapping_status,
      case when spend.seller_id is null then 'unmatched' else 'seller' end as row_type
    from spend_by_seller as spend
    left join currency_counts on currency_counts.seller_id = spend.seller_id
    left join order_counts on order_counts.seller_id = spend.seller_id
  )
  select * from general_rows
  union all
  select * from seller_rows
  order by currency, row_type, cpa nulls last, seller_name;
$$;

revoke all on function public.get_cpa_dashboard(date, date) from public, anon, authenticated;
grant execute on function public.get_cpa_dashboard(date, date) to authenticated;
