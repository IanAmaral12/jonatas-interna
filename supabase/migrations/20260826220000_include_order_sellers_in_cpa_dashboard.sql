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
      sum(insights.spend_brl) as spend
    from public.meta_campaign_hourly_insights as insights
    join public.meta_campaigns as campaigns on campaigns.id = insights.campaign_id
    cross join bounds
    where insights.bucket_start >= bounds.starts_at
      and insights.bucket_start < bounds.ends_at
      and insights.spend_brl is not null
    group by campaigns.seller_id
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
  seller_keys as (
    select seller_id from spend_by_seller where seller_id is not null
    union
    select seller_id from order_counts where seller_id is not null
  ),
  matched_seller_rows as (
    select
      'BRL'::text as currency,
      keys.seller_id,
      sellers.name as seller_name,
      coalesce(spend.spend, 0::numeric) as spend,
      coalesce(orders.appointments, 0::bigint) as appointments,
      case
        when spend.spend is not null and coalesce(orders.appointments, 0) > 0
          then round(spend.spend / orders.appointments, 2)
      end as cpa,
      false as currency_conflict,
      case when spend.spend is null then 'orders_only' else 'matched' end as mapping_status,
      'seller'::text as row_type
    from seller_keys as keys
    join public.sellers as sellers on sellers.id = keys.seller_id
    left join spend_by_seller as spend on spend.seller_id = keys.seller_id
    left join order_counts as orders on orders.seller_id = keys.seller_id
  ),
  unmatched_spend_row as (
    select
      'BRL'::text as currency,
      null::uuid as seller_id,
      'Não atribuído'::text as seller_name,
      spend.spend,
      0::bigint as appointments,
      null::numeric as cpa,
      false as currency_conflict,
      'unmatched'::text as mapping_status,
      'unmatched'::text as row_type
    from spend_by_seller as spend
    where spend.seller_id is null
  )
  select * from general_row
  union all
  select * from matched_seller_rows
  union all
  select * from unmatched_spend_row
  order by row_type, cpa nulls last, seller_name;
$$;

revoke all on function public.get_cpa_dashboard(date, date) from public, anon, authenticated;
grant execute on function public.get_cpa_dashboard(date, date) to authenticated;

comment on function public.get_cpa_dashboard(date, date) is
  'Retorna CPA em BRL e agendamentos por vendedor, incluindo vendedores com pedidos e sem investimento no período.';
