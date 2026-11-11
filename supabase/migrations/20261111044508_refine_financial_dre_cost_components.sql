create or replace function public.get_financial_dre(p_month date)
returns table (
  row_type text,
  seller_id uuid,
  seller_name text,
  order_count bigint,
  product_units bigint,
  scheduled_revenue numeric,
  confirmed_revenue numeric,
  salary_cost numeric,
  commission_pct numeric,
  commission_cost numeric,
  production_cost numeric,
  shipping_cost numeric,
  traffic_cost numeric,
  total_cost numeric,
  confirmed_balance numeric,
  remaining_to_break_even numeric,
  surplus numeric,
  configuration_pending boolean,
  units_pending boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_month is null or p_month <> date_trunc('month', p_month::timestamp)::date then
    raise exception 'Month must be the first day of a month';
  end if;

  return query
  with bounds as (
    select
      p_month::timestamp at time zone 'America/Sao_Paulo' as starts_at,
      (p_month + interval '1 month')::timestamp at time zone 'America/Sao_Paulo' as ends_at
  ),
  orders_by_seller as (
    select
      orders.seller_id,
      count(*)::bigint as order_count,
      coalesce(sum(orders.product_units), 0)::bigint as product_units,
      count(*) filter (where orders.product_units is null)::bigint as missing_units,
      coalesce(sum(orders.valor), 0)::numeric(14,2) as scheduled_revenue,
      coalesce(sum(orders.valor) filter (
        where lower(btrim(orders.status_pagamento)) = 'pago'
      ), 0)::numeric(14,2) as confirmed_revenue
    from public.orders as orders
    cross join bounds
    where orders.cancelado = false
      and orders.data >= bounds.starts_at
      and orders.data < bounds.ends_at
    group by orders.seller_id
  ),
  spend_by_seller as (
    select
      campaigns.seller_id,
      coalesce(sum(insights.spend_brl), 0)::numeric(14,2) as traffic_cost
    from public.meta_campaign_hourly_insights as insights
    join public.meta_campaigns as campaigns on campaigns.id = insights.campaign_id
    join public.meta_ad_accounts as accounts on accounts.id = insights.ad_account_id
    cross join bounds
    where insights.bucket_start >= bounds.starts_at
      and insights.bucket_start < bounds.ends_at
      and insights.spend_brl is not null
      and accounts.account_id <> '1392600858079467'
      and campaigns.id <> '52598941009722'
    group by campaigns.seller_id
  ),
  salary_by_seller as (
    select settings.seller_id, settings.monthly_salary
    from public.seller_financial_settings as settings
    where settings.effective_month = p_month
      and settings.monthly_salary is not null
  ),
  seller_keys as (
    select orders.seller_id from orders_by_seller as orders where orders.seller_id is not null
    union
    select spend.seller_id from spend_by_seller as spend where spend.seller_id is not null
    union
    select salary.seller_id from salary_by_seller as salary
  ),
  seller_base as (
    select
      'seller'::text as row_type,
      sellers.id as seller_id,
      sellers.name as seller_name,
      coalesce(orders.order_count, 0)::bigint as order_count,
      coalesce(orders.product_units, 0)::bigint as product_units,
      coalesce(orders.scheduled_revenue, 0)::numeric(14,2) as scheduled_revenue,
      coalesce(orders.confirmed_revenue, 0)::numeric(14,2) as confirmed_revenue,
      salary.monthly_salary::numeric(14,2) as salary_cost,
      rate.commission_pct::numeric(5,2) as commission_pct,
      case when rate.commission_pct is null and coalesce(orders.order_count, 0) > 0
        then null
        else round(coalesce(orders.scheduled_revenue, 0) * coalesce(rate.commission_pct, 0) / 100, 2)
      end::numeric(14,2) as commission_cost,
      case when coalesce(orders.missing_units, 0) > 0 then null
        else (coalesce(orders.product_units, 0) * 6.90)::numeric(14,2)
      end as production_cost,
      (coalesce(orders.order_count, 0) * 30)::numeric(14,2) as shipping_cost,
      coalesce(spend.traffic_cost, 0)::numeric(14,2) as traffic_cost,
      (salary.monthly_salary is null or
        ((orders.seller_id is not null or spend.seller_id is not null)
          and rate.commission_pct is null)) as configuration_pending,
      (coalesce(orders.missing_units, 0) > 0) as units_pending
    from seller_keys as keys
    join public.sellers as sellers on sellers.id = keys.seller_id
    left join orders_by_seller as orders on orders.seller_id = keys.seller_id
    left join spend_by_seller as spend on spend.seller_id = keys.seller_id
    left join salary_by_seller as salary on salary.seller_id = keys.seller_id
    left join lateral (
      select settings.commission_pct
      from public.seller_financial_settings as settings
      where settings.seller_id = keys.seller_id
        and settings.effective_month <= p_month
        and settings.commission_pct is not null
      order by settings.effective_month desc
      limit 1
    ) as rate on true
  ),
  unassigned_base as (
    select
      'unassigned'::text as row_type,
      null::uuid as seller_id,
      'Não atribuído'::text as seller_name,
      coalesce(orders.order_count, 0)::bigint as order_count,
      coalesce(orders.product_units, 0)::bigint as product_units,
      coalesce(orders.scheduled_revenue, 0)::numeric(14,2) as scheduled_revenue,
      coalesce(orders.confirmed_revenue, 0)::numeric(14,2) as confirmed_revenue,
      0::numeric(14,2) as salary_cost,
      null::numeric(5,2) as commission_pct,
      0::numeric(14,2) as commission_cost,
      case when coalesce(orders.missing_units, 0) > 0 then null
        else (coalesce(orders.product_units, 0) * 6.90)::numeric(14,2)
      end as production_cost,
      (coalesce(orders.order_count, 0) * 30)::numeric(14,2) as shipping_cost,
      coalesce(spend.traffic_cost, 0)::numeric(14,2) as traffic_cost,
      false as configuration_pending,
      (coalesce(orders.missing_units, 0) > 0) as units_pending
    from (select * from orders_by_seller where seller_id is null) as orders
    full join (select * from spend_by_seller where seller_id is null) as spend on true
  ),
  base_rows as (
    select * from seller_base
    union all
    select * from unassigned_base
  ),
  costed as (
    select
      base_rows.*,
      case when configuration_pending or units_pending then null
        else (salary_cost + commission_cost + production_cost + shipping_cost + traffic_cost)::numeric(14,2)
      end as total_cost
    from base_rows
  ),
  calculated as (
    select
      costed.row_type,
      costed.seller_id,
      costed.seller_name,
      costed.order_count,
      costed.product_units,
      costed.scheduled_revenue,
      costed.confirmed_revenue,
      costed.salary_cost,
      costed.commission_pct,
      costed.commission_cost,
      costed.production_cost,
      costed.shipping_cost,
      costed.traffic_cost,
      costed.total_cost,
      (confirmed_revenue - total_cost)::numeric(14,2) as confirmed_balance,
      case when total_cost is null then null
        else greatest(total_cost - confirmed_revenue, 0)::numeric(14,2)
      end as remaining_to_break_even,
      case when total_cost is null then null
        else greatest(confirmed_revenue - total_cost, 0)::numeric(14,2)
      end as surplus,
      costed.configuration_pending,
      costed.units_pending
    from costed
  ),
  general as (
    select
      'general'::text as row_type,
      null::uuid as seller_id,
      'Geral'::text as seller_name,
      coalesce(sum(order_count), 0)::bigint as order_count,
      coalesce(sum(product_units), 0)::bigint as product_units,
      coalesce(sum(scheduled_revenue), 0)::numeric(14,2) as scheduled_revenue,
      coalesce(sum(confirmed_revenue), 0)::numeric(14,2) as confirmed_revenue,
      case when coalesce(bool_or(salary_cost is null), false) then null
        else coalesce(sum(salary_cost), 0)::numeric(14,2) end as salary_cost,
      null::numeric(5,2) as commission_pct,
      case when coalesce(bool_or(commission_cost is null), false) then null
        else coalesce(sum(commission_cost), 0)::numeric(14,2) end as commission_cost,
      case when coalesce(bool_or(units_pending), false) then null
        else coalesce(sum(production_cost), 0)::numeric(14,2) end as production_cost,
      coalesce(sum(shipping_cost), 0)::numeric(14,2) as shipping_cost,
      coalesce(sum(traffic_cost), 0)::numeric(14,2) as traffic_cost,
      case when coalesce(bool_or(configuration_pending or units_pending), false) then null
        else coalesce(sum(total_cost), 0)::numeric(14,2) end as total_cost,
      case when coalesce(bool_or(configuration_pending or units_pending), false) then null
        else (coalesce(sum(confirmed_revenue), 0) - coalesce(sum(total_cost), 0))::numeric(14,2)
      end as confirmed_balance,
      case when coalesce(bool_or(configuration_pending or units_pending), false) then null
        else greatest(coalesce(sum(total_cost), 0) - coalesce(sum(confirmed_revenue), 0), 0)::numeric(14,2)
      end as remaining_to_break_even,
      case when coalesce(bool_or(configuration_pending or units_pending), false) then null
        else greatest(coalesce(sum(confirmed_revenue), 0) - coalesce(sum(total_cost), 0), 0)::numeric(14,2)
      end as surplus,
      coalesce(bool_or(configuration_pending), false) as configuration_pending,
      coalesce(bool_or(units_pending), false) as units_pending
    from calculated
  )
  select * from general
  union all
  select * from calculated
  order by row_type, seller_name;
end;
$$;

revoke all on function public.get_financial_dre(date) from public, anon;
grant execute on function public.get_financial_dre(date) to authenticated;

notify pgrst, 'reload schema';
