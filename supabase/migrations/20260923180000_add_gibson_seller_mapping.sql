-- Register Gibson using the full name received from Skale and the short name
-- used in Meta campaign names. Keeping both aliases also maps future records.
insert into public.sellers (name)
select 'Gibson Victor de Oliveira'
where not exists (
  select 1
  from public.sellers
  where normalized_name = public.normalize_match_text('Gibson Victor de Oliveira')
);

with gibson as (
  select sellers.id
  from public.sellers as sellers
  where sellers.normalized_name = public.normalize_match_text('Gibson Victor de Oliveira')
  order by sellers.created_at
  limit 1
), desired_aliases (alias) as (
  values
    ('Gibson'),
    ('Gibson Victor de Oliveira')
)
insert into public.seller_aliases (seller_id, alias)
select gibson.id, desired_aliases.alias
from gibson
cross join desired_aliases
on conflict (normalized_alias) do update
set seller_id = excluded.seller_id;

-- Backfill orders that arrived before the seller aliases existed.
with gibson as (
  select sellers.id
  from public.sellers as sellers
  where sellers.normalized_name = public.normalize_match_text('Gibson Victor de Oliveira')
  order by sellers.created_at
  limit 1
)
update public.orders as orders
set seller_id = gibson.id
from gibson
where orders.atendente is not null
  and public.normalize_match_text(orders.atendente) in (
    public.normalize_match_text('Gibson'),
    public.normalize_match_text('Gibson Victor de Oliveira')
  )
  and orders.seller_id is distinct from gibson.id;

-- Campaign names use the short name. Backfill every existing campaign whose
-- normalized name contains GIBSON; the alias handles future syncs automatically.
with gibson as (
  select sellers.id
  from public.sellers as sellers
  where sellers.normalized_name = public.normalize_match_text('Gibson Victor de Oliveira')
  order by sellers.created_at
  limit 1
)
update public.meta_campaigns as campaigns
set
  seller_id = gibson.id,
  mapping_source = 'auto',
  updated_at = now()
from gibson
where position(
    public.normalize_match_text('GIBSON') in campaigns.normalized_name
  ) > 0
  and (
    campaigns.seller_id is distinct from gibson.id
    or campaigns.mapping_source <> 'auto'
  );
