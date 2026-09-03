insert into public.sellers (name)
select 'Wesley'
where not exists (
  select 1
  from public.sellers
  where normalized_name = public.normalize_match_text('Wesley')
);

with wesley as (
  select id
  from public.sellers
  where normalized_name = public.normalize_match_text('Wesley')
  order by created_at
  limit 1
),
discovered_aliases as (
  select 'Wesley'::text as alias
  union
  select distinct btrim(orders.atendente)
  from public.orders as orders
  where orders.atendente is not null
    and position(
      public.normalize_match_text('Wesley')
      in public.normalize_match_text(orders.atendente)
    ) > 0
)
insert into public.seller_aliases (seller_id, alias)
select wesley.id, discovered_aliases.alias
from wesley
cross join discovered_aliases
where discovered_aliases.alias <> ''
on conflict (normalized_alias) do nothing;

with wesley as (
  select id
  from public.sellers
  where normalized_name = public.normalize_match_text('Wesley')
  order by created_at
  limit 1
)
update public.orders as orders
set seller_id = wesley.id
from wesley
where orders.atendente is not null
  and exists (
    select 1
    from public.seller_aliases as aliases
    where aliases.seller_id = wesley.id
      and aliases.normalized_alias = public.normalize_match_text(orders.atendente)
  )
  and orders.seller_id is distinct from wesley.id;

with wesley as (
  select id
  from public.sellers
  where normalized_name = public.normalize_match_text('Wesley')
  order by created_at
  limit 1
),
resolved_campaigns as (
  select campaigns.id, resolved.seller_id
  from public.meta_campaigns as campaigns
  cross join lateral public.resolve_meta_campaign_seller(campaigns.name) as resolved
)
update public.meta_campaigns as campaigns
set
  seller_id = wesley.id,
  mapping_source = 'auto',
  updated_at = now()
from wesley
join resolved_campaigns on resolved_campaigns.seller_id = wesley.id
where campaigns.id = resolved_campaigns.id
  and campaigns.mapping_source <> 'manual'
  and (
    campaigns.seller_id is distinct from wesley.id
    or campaigns.mapping_source <> 'auto'
  );

do $validation$
declare
  wesley_id uuid;
  mapped_orders bigint;
  eligible_orders bigint;
  mapped_campaigns bigint;
  hourly_traffic_rows bigint;
  daily_action_rows bigint;
begin
  select id
  into wesley_id
  from public.sellers
  where normalized_name = public.normalize_match_text('Wesley')
  order by created_at
  limit 1;

  select
    count(*),
    count(*) filter (where cancelado = false)
  into mapped_orders, eligible_orders
  from public.orders
  where seller_id = wesley_id;

  select count(*)
  into mapped_campaigns
  from public.meta_campaigns
  where seller_id = wesley_id;

  select count(*)
  into hourly_traffic_rows
  from public.meta_campaign_hourly_insights as insights
  join public.meta_campaigns as campaigns on campaigns.id = insights.campaign_id
  where campaigns.seller_id = wesley_id;

  select count(*)
  into daily_action_rows
  from public.meta_campaign_daily_actions as actions
  join public.meta_campaigns as campaigns on campaigns.id = actions.campaign_id
  where campaigns.seller_id = wesley_id;

  raise notice
    'Wesley mapping validated: orders=%, eligible_orders=%, campaigns=%, hourly_traffic_rows=%, daily_action_rows=%',
    mapped_orders,
    eligible_orders,
    mapped_campaigns,
    hourly_traffic_rows,
    daily_action_rows;
end;
$validation$;
