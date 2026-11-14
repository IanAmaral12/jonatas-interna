-- Skale supplies the full name; Meta campaigns identify this seller as Lucas.
insert into public.sellers (name)
select 'Antonio Lucas Carvalho Bezerra'
where not exists (
  select 1 from public.sellers
  where normalized_name = public.normalize_match_text('Antonio Lucas Carvalho Bezerra')
);

with lucas as (
  select id from public.sellers
  where normalized_name = public.normalize_match_text('Antonio Lucas Carvalho Bezerra')
  order by created_at
  limit 1
)
insert into public.seller_aliases (seller_id, alias)
select lucas.id, aliases.alias
from lucas
cross join (values ('Lucas'), ('Antonio Lucas Carvalho Bezerra')) as aliases(alias)
on conflict (normalized_alias) do update set seller_id = excluded.seller_id;

-- Recover orders received before the aliases were registered.
update public.orders as orders
set seller_id = sellers.id
from public.sellers as sellers
where sellers.normalized_name = public.normalize_match_text('Antonio Lucas Carvalho Bezerra')
  and public.normalize_match_text(orders.atendente) in (
    public.normalize_match_text('Lucas'),
    public.normalize_match_text('Antonio Lucas Carvalho Bezerra')
  )
  and orders.seller_id is distinct from sellers.id;

-- Preserve manual and ambiguous mappings while attributing stored metrics.
with resolved_campaigns as (
  select campaigns.id, resolved.seller_id
  from public.meta_campaigns as campaigns
  cross join lateral public.resolve_meta_campaign_seller(campaigns.name) as resolved
  join public.sellers as sellers on sellers.id = resolved.seller_id
  where sellers.normalized_name = public.normalize_match_text('Antonio Lucas Carvalho Bezerra')
    and campaigns.mapping_source <> 'manual'
)
update public.meta_campaigns as campaigns
set seller_id = resolved_campaigns.seller_id,
    mapping_source = 'auto',
    updated_at = now()
from resolved_campaigns
where campaigns.id = resolved_campaigns.id
  and (campaigns.seller_id is distinct from resolved_campaigns.seller_id
    or campaigns.mapping_source <> 'auto');
