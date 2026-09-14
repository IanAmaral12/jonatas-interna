-- There were no existing entries when this migration was prepared. The explicit
-- timezone also makes the date-to-timestamp conversion deterministic.
alter table public.pre_appointments rename column appointment_date to appointment_at;
alter table public.pre_appointments alter column appointment_at type timestamptz
  using appointment_at::timestamp at time zone 'America/Sao_Paulo';

create or replace function public.get_pre_appointment_totals(p_start_date date, p_end_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(totals) order by totals.appointment_date, totals.seller_name), '[]'::jsonb)
  from (
    select entries.seller_id, sellers.name as seller_name,
      (entries.appointment_at at time zone 'America/Sao_Paulo')::date as appointment_date,
      sum(entries.quantity)::bigint as quantity
    from public.pre_appointments as entries
    join public.sellers as sellers on sellers.id = entries.seller_id
    where entries.expires_at > now()
      and entries.appointment_at >= p_start_date::timestamp at time zone 'America/Sao_Paulo'
      and entries.appointment_at < (p_end_date + 1)::timestamp at time zone 'America/Sao_Paulo'
    group by entries.seller_id, sellers.name, 3
  ) as totals;
$$;

-- Private source shared by both charts. A manual batch is one weighted event,
-- not N fabricated orders. Canceled orders and expired batches never contribute.
create function public.dashboard_appointment_events(
  p_start_date date, p_end_date date, p_seller_id uuid, p_include_pre boolean
)
returns table (event_id text, happened_at timestamptz, seller_id uuid, quantity bigint)
language sql stable security definer set search_path = '' as $$
  select 'order:' || orders.id, orders.data, orders.seller_id, 1::bigint
  from public.orders as orders
  where orders.cancelado = false
    and (p_seller_id is null or orders.seller_id = p_seller_id)
    and orders.data >= p_start_date::timestamp at time zone 'America/Sao_Paulo'
    and orders.data < (p_end_date + 1)::timestamp at time zone 'America/Sao_Paulo'
  union all
  select 'pre:' || entries.id::text, entries.appointment_at, entries.seller_id, entries.quantity::bigint
  from public.pre_appointments as entries
  where p_include_pre is true and entries.expires_at > now()
    and (p_seller_id is null or entries.seller_id = p_seller_id)
    and entries.appointment_at >= p_start_date::timestamp at time zone 'America/Sao_Paulo'
    and entries.appointment_at < (p_end_date + 1)::timestamp at time zone 'America/Sao_Paulo';
$$;
revoke all on function public.dashboard_appointment_events(date, date, uuid, boolean)
  from public, anon, authenticated;

create function public.get_orders_sales_timeline(
  p_start_date date, p_end_date date, p_seller_id uuid, p_include_pre boolean
)
returns table (
  bucket_start timestamptz, sales bigint, granularity text, comparison_mode text,
  series_start date, bucket_index integer, milestones jsonb
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_include_pre is not true then
    return query select * from public.get_orders_sales_timeline(p_start_date, p_end_date, p_seller_id);
    return;
  end if;
  return query
  with events as materialized (
    select * from public.dashboard_appointment_events(p_start_date, p_end_date, p_seller_id, true)
  ), settings as (
    select (p_end_date - p_start_date + 1) between 1 and 7 as is_hourly,
      (case when p_start_date = date_trunc('month', p_start_date::timestamp)::date then p_start_date
        else (date_trunc('month', p_start_date::timestamp) + interval '1 month')::date end
        + interval '1 month' - interval '1 day')::date <= p_end_date as is_monthly,
      greatest(current_timestamp at time zone 'America/Sao_Paulo',
        (select max(happened_at) at time zone 'America/Sao_Paulo' from events)) as latest_local
  ), buckets as (
    select generated.bucket_local
    from settings cross join lateral generate_series(
      p_start_date::timestamp,
      case when settings.is_hourly
        then least(p_end_date::timestamp + interval '23 hours', date_trunc('hour', settings.latest_local))
        else least(p_end_date::timestamp, date_trunc('day', settings.latest_local)) end,
      case when settings.is_hourly then interval '1 hour' else interval '1 day' end
    ) as generated(bucket_local)
    where p_start_date <= p_end_date
  ), counts as (
    select date_trunc(case when settings.is_hourly then 'hour' else 'day' end,
      events.happened_at at time zone 'America/Sao_Paulo') as bucket_local,
      sum(events.quantity)::bigint as sales
    from events cross join settings group by 1
  ), cumulative as (
    select events.*,
      sum(events.quantity) over (
        partition by (events.happened_at at time zone 'America/Sao_Paulo')::date
        order by events.happened_at, events.event_id rows unbounded preceding
      )::bigint as daily_total
    from events cross join settings where settings.is_hourly
  ), reached as (
    select date_trunc('hour', cumulative.happened_at at time zone 'America/Sao_Paulo') as bucket_local,
      thresholds.threshold, cumulative.happened_at
    from cumulative cross join lateral generate_series(
      ((cumulative.daily_total - cumulative.quantity) / 10 + 1) * 10,
      (cumulative.daily_total / 10) * 10, 10::bigint
    ) as thresholds(threshold)
  ), markers as (
    select reached.bucket_local, jsonb_agg(jsonb_build_object(
      'threshold', reached.threshold, 'reached_at', reached.happened_at
    ) order by reached.threshold) as milestones
    from reached group by reached.bucket_local
  )
  select buckets.bucket_local at time zone 'America/Sao_Paulo', coalesce(counts.sales, 0::bigint),
    case when settings.is_hourly then 'hour' else 'day' end,
    case when settings.is_hourly then 'day_hours' when settings.is_monthly then 'month_days' else 'week_days' end,
    case when settings.is_hourly then buckets.bucket_local::date
      when settings.is_monthly then date_trunc('month', buckets.bucket_local)::date
      else buckets.bucket_local::date - extract(dow from buckets.bucket_local)::integer end,
    case when settings.is_hourly then extract(hour from buckets.bucket_local)::integer
      when settings.is_monthly then extract(day from buckets.bucket_local)::integer - 1
      else extract(dow from buckets.bucket_local)::integer end,
    coalesce(markers.milestones, '[]'::jsonb)
  from buckets cross join settings
  left join counts using (bucket_local) left join markers using (bucket_local)
  order by buckets.bucket_local;
end;
$$;

create function public.get_seller_sales_timeline(
  p_start_date date, p_end_date date, p_seller_id uuid, p_include_pre boolean
)
returns table (bucket_start timestamptz, seller_id uuid, seller_name text, sales bigint, comparison_mode text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_include_pre is not true then
    return query select * from public.get_seller_sales_timeline(p_start_date, p_end_date, p_seller_id);
    return;
  end if;
  return query
  with settings as (
    select case when p_start_date = p_end_date then 'seller_hours'
      when p_end_date - p_start_date + 1 between 2 and 7 then 'seller_days'
      when (case when p_start_date = date_trunc('month', p_start_date::timestamp)::date then p_start_date
        else (date_trunc('month', p_start_date::timestamp) + interval '1 month')::date end
        + interval '1 month' - interval '1 day')::date <= p_end_date then 'seller_months'
      else 'seller_weeks' end as mode
  ), events as materialized (
    select * from public.dashboard_appointment_events(p_start_date, p_end_date, p_seller_id, true)
  ), grouped_events as (
    select events.seller_id, events.quantity,
      case when settings.mode = 'seller_hours' then date_trunc('hour', local_time.value)
        when settings.mode = 'seller_days' then date_trunc('day', local_time.value)
        when settings.mode = 'seller_months' then date_trunc('month', local_time.value)
        else (local_time.value::date - extract(dow from local_time.value)::integer)::timestamp end as bucket_local
    from events cross join settings
    cross join lateral (select events.happened_at at time zone 'America/Sao_Paulo' as value) as local_time
  ), buckets as (
    select distinct case when settings.mode = 'seller_hours' then local_time.value
      when settings.mode = 'seller_days' then date_trunc('day', local_time.value)
      when settings.mode = 'seller_months' then date_trunc('month', local_time.value)
      else (local_time.value::date - extract(dow from local_time.value)::integer)::timestamp end as bucket_local
    from public.get_orders_sales_timeline(p_start_date, p_end_date, p_seller_id, true) as timeline
    cross join settings
    cross join lateral (select timeline.bucket_start at time zone 'America/Sao_Paulo' as value) as local_time
  ), seller_keys as (
    select distinct sellers.id, sellers.name from events
    join public.sellers as sellers on sellers.id = events.seller_id where sellers.active
  ), counts as (
    select grouped_events.seller_id, grouped_events.bucket_local, sum(grouped_events.quantity)::bigint as sales
    from grouped_events group by grouped_events.seller_id, grouped_events.bucket_local
  )
  select buckets.bucket_local at time zone 'America/Sao_Paulo', seller_keys.id, seller_keys.name,
    coalesce(counts.sales, 0::bigint), settings.mode
  from buckets cross join seller_keys cross join settings
  left join counts on counts.seller_id = seller_keys.id and counts.bucket_local = buckets.bucket_local
  order by buckets.bucket_local, seller_keys.name;
end;
$$;

revoke all on function public.get_orders_sales_timeline(date, date, uuid, boolean) from public, anon, authenticated;
revoke all on function public.get_seller_sales_timeline(date, date, uuid, boolean) from public, anon, authenticated;
grant execute on function public.get_orders_sales_timeline(date, date, uuid, boolean) to authenticated;
grant execute on function public.get_seller_sales_timeline(date, date, uuid, boolean) to authenticated;
comment on column public.pre_appointments.appointment_at is
  'Data e hora informadas no fuso America/Sao_Paulo. Toda a quantidade do lançamento ocorre neste instante.';
