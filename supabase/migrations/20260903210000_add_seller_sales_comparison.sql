create or replace function public.get_seller_sales_timeline(
  p_start_date date,
  p_end_date date,
  p_seller_id uuid
)
returns table (
  bucket_start timestamptz,
  seller_id uuid,
  seller_name text,
  sales bigint,
  comparison_mode text
)
language sql
stable
security definer
set search_path = ''
as $$
  with base_settings as (
    select
      (p_end_date - p_start_date) + 1 as selected_days,
      case
        when p_start_date = date_trunc('month', p_start_date::timestamp)::date
          then p_start_date
        else (date_trunc('month', p_start_date::timestamp) + interval '1 month')::date
      end as first_full_month,
      p_start_date::timestamp at time zone 'America/Sao_Paulo' as starts_at,
      (p_end_date + 1)::timestamp at time zone 'America/Sao_Paulo' as ends_at,
      (current_timestamp at time zone 'America/Sao_Paulo')::date as local_today,
      current_timestamp at time zone 'America/Sao_Paulo' as local_now
  ),
  settings as (
    select
      base_settings.*,
      base_settings.selected_days = 1 as is_hourly,
      base_settings.selected_days between 2 and 7 as is_daily,
      (
        base_settings.first_full_month + interval '1 month' - interval '1 day'
      )::date <= p_end_date as is_monthly
    from base_settings
  ),
  series_limits as (
    select
      settings.*,
      case
        when settings.is_hourly and p_end_date >= settings.local_today
          then date_trunc('hour', settings.local_now)
        when settings.is_hourly
          then p_end_date::timestamp + interval '23 hours'
        when p_end_date >= settings.local_today
          then settings.local_today::timestamp
        else p_end_date::timestamp
      end as last_bucket,
      case
        when settings.is_hourly then interval '1 hour'
        else interval '1 day'
      end as bucket_step
    from settings
  ),
  generated_buckets as (
    select generated.bucket_local
    from series_limits
    cross join lateral generate_series(
      p_start_date::timestamp,
      series_limits.last_bucket,
      series_limits.bucket_step
    ) as generated(bucket_local)
    where p_start_date is not null
      and p_end_date is not null
      and p_start_date <= p_end_date
  ),
  buckets as (
    select distinct
      case
        when settings.is_hourly then generated_buckets.bucket_local
        when settings.is_daily then date_trunc('day', generated_buckets.bucket_local)
        when settings.is_monthly then date_trunc('month', generated_buckets.bucket_local)
        else (
          generated_buckets.bucket_local::date
          - extract(dow from generated_buckets.bucket_local)::integer
        )::timestamp
      end as bucket_local
    from generated_buckets
    cross join settings
  ),
  seller_keys as (
    select distinct orders.seller_id
    from public.orders as orders
    cross join settings
    join public.sellers as sellers on sellers.id = orders.seller_id
    where orders.cancelado = false
      and orders.seller_id is not null
      and sellers.active = true
      and (p_seller_id is null or orders.seller_id = p_seller_id)
      and orders.data >= settings.starts_at
      and orders.data < settings.ends_at
  ),
  order_counts as (
    select
      orders.seller_id,
      case
        when settings.is_hourly
          then date_trunc('hour', orders.data at time zone 'America/Sao_Paulo')
        when settings.is_daily
          then date_trunc('day', orders.data at time zone 'America/Sao_Paulo')
        when settings.is_monthly
          then date_trunc('month', orders.data at time zone 'America/Sao_Paulo')
        else (
          (orders.data at time zone 'America/Sao_Paulo')::date
          - extract(dow from orders.data at time zone 'America/Sao_Paulo')::integer
        )::timestamp
      end as bucket_local,
      count(*)::bigint as sales
    from public.orders as orders
    cross join settings
    where orders.cancelado = false
      and orders.seller_id is not null
      and (p_seller_id is null or orders.seller_id = p_seller_id)
      and orders.data >= settings.starts_at
      and orders.data < settings.ends_at
    group by orders.seller_id, 2
  )
  select
    buckets.bucket_local at time zone 'America/Sao_Paulo' as bucket_start,
    sellers.id as seller_id,
    sellers.name as seller_name,
    coalesce(order_counts.sales, 0::bigint) as sales,
    case
      when settings.is_hourly then 'seller_hours'
      when settings.is_daily then 'seller_days'
      when settings.is_monthly then 'seller_months'
      else 'seller_weeks'
    end as comparison_mode
  from buckets
  cross join seller_keys
  cross join settings
  join public.sellers as sellers on sellers.id = seller_keys.seller_id
  left join order_counts
    on order_counts.seller_id = seller_keys.seller_id
    and order_counts.bucket_local = buckets.bucket_local
  order by buckets.bucket_local, sellers.name;
$$;

revoke all on function public.get_seller_sales_timeline(date, date, uuid)
  from public, anon, authenticated;

grant execute on function public.get_seller_sales_timeline(date, date, uuid)
  to authenticated;

comment on function public.get_seller_sales_timeline(date, date, uuid) is
  'Compara pedidos não cancelados por vendedor, agrupando por hora, dia, semana ou mês conforme o período selecionado.';
