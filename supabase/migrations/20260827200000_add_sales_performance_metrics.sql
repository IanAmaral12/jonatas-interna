drop function if exists public.get_cpa_dashboard(date, date);

create function public.get_cpa_dashboard(
  p_start_date date,
  p_end_date date
)
returns table (
  currency text,
  seller_id uuid,
  seller_name text,
  spend numeric,
  leads bigint,
  appointments bigint,
  sales bigint,
  revenue numeric,
  cpa numeric,
  conversion_rate numeric,
  lead_to_sale_ratio numeric,
  roas numeric,
  average_ticket numeric,
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
  traffic_by_seller as (
    select
      campaigns.seller_id,
      sum(insights.spend_brl) as spend,
      sum(insights.inline_link_clicks)::bigint as leads
    from public.meta_campaign_hourly_insights as insights
    join public.meta_campaigns as campaigns on campaigns.id = insights.campaign_id
    cross join bounds
    where insights.bucket_start >= bounds.starts_at
      and insights.bucket_start < bounds.ends_at
      and insights.spend_brl is not null
    group by campaigns.seller_id
  ),
  orders_by_seller as (
    select
      orders.seller_id,
      count(*)::bigint as appointments,
      count(*) filter (where orders.data_pagamento is not null)::bigint as sales,
      coalesce(
        sum(orders.valor) filter (where orders.data_pagamento is not null),
        0::numeric
      ) as revenue
    from public.orders as orders
    cross join bounds
    where orders.cancelado = false
      and orders.seller_id is not null
      and orders.data >= bounds.starts_at
      and orders.data < bounds.ends_at
    group by orders.seller_id
  ),
  total_orders as (
    select
      count(*)::bigint as appointments,
      count(*) filter (where orders.data_pagamento is not null)::bigint as sales,
      coalesce(
        sum(orders.valor) filter (where orders.data_pagamento is not null),
        0::numeric
      ) as revenue
    from public.orders as orders
    cross join bounds
    where orders.cancelado = false
      and orders.data >= bounds.starts_at
      and orders.data < bounds.ends_at
  ),
  traffic_totals as (
    select
      coalesce(sum(traffic.spend), 0::numeric) as spend,
      coalesce(sum(traffic.leads), 0::numeric)::bigint as leads
    from traffic_by_seller as traffic
  ),
  general_row as (
    select
      'BRL'::text as currency,
      null::uuid as seller_id,
      'Geral'::text as seller_name,
      traffic.spend,
      traffic.leads,
      orders.appointments,
      orders.sales,
      orders.revenue,
      case
        when orders.appointments > 0 then round(traffic.spend / orders.appointments, 2)
      end as cpa,
      case
        when traffic.leads > 0 then round((orders.sales::numeric / traffic.leads) * 100, 2)
      end as conversion_rate,
      case
        when orders.sales > 0 then round(traffic.leads::numeric / orders.sales, 2)
      end as lead_to_sale_ratio,
      case
        when traffic.spend > 0 then round(orders.revenue / traffic.spend, 2)
      end as roas,
      case
        when orders.sales > 0 then round(orders.revenue / orders.sales, 2)
      end as average_ticket,
      false as currency_conflict,
      'general'::text as mapping_status,
      'general'::text as row_type
    from traffic_totals as traffic
    cross join total_orders as orders
  ),
  seller_keys as (
    select seller_id from traffic_by_seller where seller_id is not null
    union
    select seller_id from orders_by_seller where seller_id is not null
  ),
  matched_seller_rows as (
    select
      'BRL'::text as currency,
      keys.seller_id,
      sellers.name as seller_name,
      coalesce(traffic.spend, 0::numeric) as spend,
      coalesce(traffic.leads, 0::bigint) as leads,
      coalesce(orders.appointments, 0::bigint) as appointments,
      coalesce(orders.sales, 0::bigint) as sales,
      coalesce(orders.revenue, 0::numeric) as revenue,
      case
        when traffic.spend is not null and coalesce(orders.appointments, 0) > 0
          then round(traffic.spend / orders.appointments, 2)
      end as cpa,
      case
        when coalesce(traffic.leads, 0) > 0
          then round((coalesce(orders.sales, 0)::numeric / traffic.leads) * 100, 2)
      end as conversion_rate,
      case
        when coalesce(orders.sales, 0) > 0
          then round(coalesce(traffic.leads, 0)::numeric / orders.sales, 2)
      end as lead_to_sale_ratio,
      case
        when coalesce(traffic.spend, 0) > 0
          then round(coalesce(orders.revenue, 0) / traffic.spend, 2)
      end as roas,
      case
        when coalesce(orders.sales, 0) > 0
          then round(coalesce(orders.revenue, 0) / orders.sales, 2)
      end as average_ticket,
      false as currency_conflict,
      case when traffic.spend is null then 'orders_only' else 'matched' end as mapping_status,
      'seller'::text as row_type
    from seller_keys as keys
    join public.sellers as sellers on sellers.id = keys.seller_id
    left join traffic_by_seller as traffic on traffic.seller_id = keys.seller_id
    left join orders_by_seller as orders on orders.seller_id = keys.seller_id
  ),
  unmatched_traffic_row as (
    select
      'BRL'::text as currency,
      null::uuid as seller_id,
      'Não atribuído'::text as seller_name,
      traffic.spend,
      traffic.leads,
      0::bigint as appointments,
      0::bigint as sales,
      0::numeric as revenue,
      null::numeric as cpa,
      0::numeric as conversion_rate,
      null::numeric as lead_to_sale_ratio,
      0::numeric as roas,
      null::numeric as average_ticket,
      false as currency_conflict,
      'unmatched'::text as mapping_status,
      'unmatched'::text as row_type
    from traffic_by_seller as traffic
    where traffic.seller_id is null
  )
  select * from general_row
  union all
  select * from matched_seller_rows
  union all
  select * from unmatched_traffic_row
  order by row_type, cpa nulls last, seller_name;
$$;

revoke all on function public.get_cpa_dashboard(date, date) from public, anon, authenticated;
grant execute on function public.get_cpa_dashboard(date, date) to authenticated;

comment on function public.get_cpa_dashboard(date, date) is
  'Retorna mídia, leads por clique no link, agendamentos, vendas pagas, faturamento, CPA, conversão, ROAS e ticket médio em BRL.';
