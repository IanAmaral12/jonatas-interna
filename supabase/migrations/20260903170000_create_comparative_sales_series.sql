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
  with settings as (
    select
      (p_end_date - p_start_date) + 1 as selected_days,
      (p_end_date - p_start_date) + 1 between 1 and 7 as is_hourly,
      p_start_date::timestamp at time zone 'America/Sao_Paulo' as starts_at,
      (p_end_date + 1)::timestamp at time zone 'America/Sao_Paulo' as ends_at,
      (current_timestamp at time zone 'America/Sao_Paulo')::date as local_today,
      current_timestamp at time zone 'America/Sao_Paulo' as local_now
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
      when settings.selected_days <= 7 then 'day_hours'
      when settings.selected_days <= 29 then 'week_days'
      else 'month_days'
    end as comparison_mode,
    case
      when settings.selected_days <= 7 then buckets.bucket_local::date
      when settings.selected_days <= 29
        then buckets.bucket_local::date - extract(dow from buckets.bucket_local)::integer
      else date_trunc('month', buckets.bucket_local)::date
    end as series_start,
    case
      when settings.selected_days <= 7 then extract(hour from buckets.bucket_local)::integer
      when settings.selected_days <= 29 then extract(dow from buckets.bucket_local)::integer
      else extract(day from buckets.bucket_local)::integer - 1
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
  'Retorna séries comparativas de pedidos não cancelados: dias por hora até 7 dias, semanas por dia entre 8 e 29 dias e meses por dia a partir de 30 dias.';
