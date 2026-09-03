drop function if exists public.get_orders_sales_timeline(date, date);

create function public.get_orders_sales_timeline(
  p_start_date date,
  p_end_date date
)
returns table (
  bucket_start timestamptz,
  sales bigint,
  granularity text,
  comparison_mode text,
  series_start date,
  bucket_index integer
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
      base_settings.selected_days between 1 and 7 as is_hourly,
      (
        base_settings.first_full_month + interval '1 month' - interval '1 day'
      )::date <= p_end_date as is_monthly
    from base_settings
  ),
  bucket_limits as (
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
  buckets as (
    select generated.bucket_local
    from bucket_limits
    cross join lateral generate_series(
      p_start_date::timestamp,
      bucket_limits.last_bucket,
      bucket_limits.bucket_step
    ) as generated(bucket_local)
    where p_start_date is not null
      and p_end_date is not null
      and p_start_date <= p_end_date
  ),
  order_counts as (
    select
      case
        when settings.is_hourly
          then date_trunc('hour', orders.data at time zone 'America/Sao_Paulo')
        else date_trunc('day', orders.data at time zone 'America/Sao_Paulo')
      end as bucket_local,
      count(*)::bigint as sales
    from public.orders as orders
    cross join settings
    where orders.cancelado = false
      and orders.data >= settings.starts_at
      and orders.data < settings.ends_at
    group by 1
  )
  select
    buckets.bucket_local at time zone 'America/Sao_Paulo' as bucket_start,
    coalesce(order_counts.sales, 0::bigint) as sales,
    case when settings.is_hourly then 'hour' else 'day' end as granularity,
    case
      when settings.is_hourly then 'day_hours'
      when settings.is_monthly then 'month_days'
      else 'week_days'
    end as comparison_mode,
    case
      when settings.is_hourly then buckets.bucket_local::date
      when settings.is_monthly then date_trunc('month', buckets.bucket_local)::date
      else buckets.bucket_local::date - extract(dow from buckets.bucket_local)::integer
    end as series_start,
    case
      when settings.is_hourly then extract(hour from buckets.bucket_local)::integer
      when settings.is_monthly then extract(day from buckets.bucket_local)::integer - 1
      else extract(dow from buckets.bucket_local)::integer
    end as bucket_index
  from buckets
  cross join settings
  left join order_counts using (bucket_local)
  order by buckets.bucket_local;
$$;

revoke all on function public.get_orders_sales_timeline(date, date)
  from public, anon, authenticated;

grant execute on function public.get_orders_sales_timeline(date, date)
  to authenticated;

comment on function public.get_orders_sales_timeline(date, date) is
  'Retorna séries comparativas por hora até 7 dias, por semana em períodos maiores sem mês completo e por mês quando o intervalo inclui ao menos um mês civil completo.';
