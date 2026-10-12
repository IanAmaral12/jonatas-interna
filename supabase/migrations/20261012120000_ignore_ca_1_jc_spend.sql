create or replace function public.get_cpa_dashboard(
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
  revenue numeric,
  cpa numeric,
  conversion_rate numeric,
  lead_to_appointment_ratio numeric,
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
  spend_by_seller as (
    select
      campaigns.seller_id,
      sum(insights.spend_brl) as spend
    from public.meta_campaign_hourly_insights as insights
    join public.meta_campaigns as campaigns on campaigns.id = insights.campaign_id
    join public.meta_ad_accounts as accounts on accounts.id = insights.ad_account_id
    cross join bounds
    where insights.bucket_start >= bounds.starts_at
      and insights.bucket_start < bounds.ends_at
      and insights.spend_brl is not null
      -- Exclui historicamente a conta CA1 - JC e somente a campanha CURTIDA 01
      -- da outra conta. Os dados brutos permanecem preservados para auditoria.
      and accounts.account_id <> '1392600858079467'
      and campaigns.id <> '52598941009722'
    group by campaigns.seller_id
  ),
  conversations_by_seller as (
    select
      campaigns.seller_id,
      sum(actions.messaging_conversations_started)::bigint as leads
    from public.meta_campaign_daily_actions as actions
    join public.meta_campaigns as campaigns on campaigns.id = actions.campaign_id
    where actions.metric_date between p_start_date and p_end_date
    group by campaigns.seller_id
  ),
  orders_by_seller as (
    select
      orders.seller_id,
      count(*)::bigint as appointments,
      coalesce(sum(orders.valor), 0::numeric) as revenue
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
      coalesce(sum(orders.valor), 0::numeric) as revenue
    from public.orders as orders
    cross join bounds
    where orders.cancelado = false
      and orders.data >= bounds.starts_at
      and orders.data < bounds.ends_at
  ),
  media_totals as (
    select
      coalesce((select sum(spend) from spend_by_seller), 0::numeric) as spend,
      coalesce((select sum(leads) from conversations_by_seller), 0::numeric)::bigint as leads
  ),
  general_row as (
    select
      'BRL'::text as currency,
      null::uuid as seller_id,
      'Geral'::text as seller_name,
      media.spend,
      media.leads,
      orders.appointments,
      orders.revenue,
      case
        when orders.appointments > 0 then round(media.spend / orders.appointments, 2)
      end as cpa,
      case
        when media.leads > 0 then round((orders.appointments::numeric / media.leads) * 100, 2)
      end as conversion_rate,
      case
        when orders.appointments > 0 then round(media.leads::numeric / orders.appointments, 2)
      end as lead_to_appointment_ratio,
      case
        when media.spend > 0 then round(orders.revenue / media.spend, 2)
      end as roas,
      case
        when orders.appointments > 0 then round(orders.revenue / orders.appointments, 2)
      end as average_ticket,
      false as currency_conflict,
      'general'::text as mapping_status,
      'general'::text as row_type
    from media_totals as media
    cross join total_orders as orders
  ),
  seller_keys as (
    select seller_id from spend_by_seller where seller_id is not null
    union
    select seller_id from conversations_by_seller where seller_id is not null
    union
    select seller_id from orders_by_seller where seller_id is not null
  ),
  matched_seller_rows as (
    select
      'BRL'::text as currency,
      keys.seller_id,
      sellers.name as seller_name,
      coalesce(spend.spend, 0::numeric) as spend,
      coalesce(conversations.leads, 0::bigint) as leads,
      coalesce(orders.appointments, 0::bigint) as appointments,
      coalesce(orders.revenue, 0::numeric) as revenue,
      case
        when spend.spend is not null and coalesce(orders.appointments, 0) > 0
          then round(spend.spend / orders.appointments, 2)
      end as cpa,
      case
        when coalesce(conversations.leads, 0) > 0
          then round((coalesce(orders.appointments, 0)::numeric / conversations.leads) * 100, 2)
      end as conversion_rate,
      case
        when coalesce(orders.appointments, 0) > 0
          then round(coalesce(conversations.leads, 0)::numeric / orders.appointments, 2)
      end as lead_to_appointment_ratio,
      case
        when coalesce(spend.spend, 0) > 0
          then round(coalesce(orders.revenue, 0) / spend.spend, 2)
      end as roas,
      case
        when coalesce(orders.appointments, 0) > 0
          then round(coalesce(orders.revenue, 0) / orders.appointments, 2)
      end as average_ticket,
      false as currency_conflict,
      case
        when spend.spend is null and conversations.leads is null then 'orders_only'
        else 'matched'
      end as mapping_status,
      'seller'::text as row_type
    from seller_keys as keys
    join public.sellers as sellers on sellers.id = keys.seller_id
    left join spend_by_seller as spend on spend.seller_id = keys.seller_id
    left join conversations_by_seller as conversations on conversations.seller_id = keys.seller_id
    left join orders_by_seller as orders on orders.seller_id = keys.seller_id
  ),
  unmatched_media_row as (
    select
      'BRL'::text as currency,
      null::uuid as seller_id,
      'Não atribuído'::text as seller_name,
      coalesce(spend.spend, 0::numeric) as spend,
      coalesce(conversations.leads, 0::bigint) as leads,
      0::bigint as appointments,
      0::numeric as revenue,
      null::numeric as cpa,
      0::numeric as conversion_rate,
      null::numeric as lead_to_appointment_ratio,
      0::numeric as roas,
      null::numeric as average_ticket,
      false as currency_conflict,
      'unmatched'::text as mapping_status,
      'unmatched'::text as row_type
    from (select spend from spend_by_seller where seller_id is null) as spend
    full join (select leads from conversations_by_seller where seller_id is null) as conversations
      on true
  )
  select * from general_row
  union all
  select * from matched_seller_rows
  union all
  select * from unmatched_media_row
  order by row_type, cpa nulls last, seller_name;
$$;

revoke all on function public.get_cpa_dashboard(date, date) from public, anon, authenticated;
grant execute on function public.get_cpa_dashboard(date, date) to authenticated;

comment on function public.get_cpa_dashboard(date, date) is
  'Retorna as métricas comerciais em BRL, desconsiderando o investimento da conta CA1 - JC e da campanha CURTIDA 01.';
