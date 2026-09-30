-- Register Gabbriel using the full name received from Skale and the short name
-- used in Meta campaign names. Both aliases also map future records.
insert into public.sellers (name)
select 'Gabbriel Oliveira da Silva'
where not exists (
  select 1
  from public.sellers
  where normalized_name = public.normalize_match_text('Gabbriel Oliveira da Silva')
);

with gabbriel as (
  select sellers.id
  from public.sellers as sellers
  where sellers.normalized_name = public.normalize_match_text('Gabbriel Oliveira da Silva')
  order by sellers.created_at
  limit 1
), desired_aliases (alias) as (
  values
    ('Gabbriel'),
    ('Gabbriel Oliveira da Silva')
)
insert into public.seller_aliases (seller_id, alias)
select gabbriel.id, desired_aliases.alias
from gabbriel
cross join desired_aliases
on conflict (normalized_alias) do update
set seller_id = excluded.seller_id;

-- Backfill Skale orders that arrived before the seller aliases existed.
with gabbriel as (
  select sellers.id
  from public.sellers as sellers
  where sellers.normalized_name = public.normalize_match_text('Gabbriel Oliveira da Silva')
  order by sellers.created_at
  limit 1
)
update public.orders as orders
set seller_id = gabbriel.id
from gabbriel
where orders.atendente is not null
  and public.normalize_match_text(orders.atendente) in (
    public.normalize_match_text('Gabbriel'),
    public.normalize_match_text('Gabbriel Oliveira da Silva')
  )
  and orders.seller_id is distinct from gabbriel.id;

-- Linking existing campaigns retroactively attributes all their stored spend.
-- The short alias lets future Meta syncs resolve new GABBRIEL campaigns.
with gabbriel as (
  select sellers.id
  from public.sellers as sellers
  where sellers.normalized_name = public.normalize_match_text('Gabbriel Oliveira da Silva')
  order by sellers.created_at
  limit 1
)
update public.meta_campaigns as campaigns
set
  seller_id = gabbriel.id,
  mapping_source = 'auto',
  updated_at = now()
from gabbriel
where position(
    public.normalize_match_text('GABBRIEL') in campaigns.normalized_name
  ) > 0
  and (
    campaigns.seller_id is distinct from gabbriel.id
    or campaigns.mapping_source <> 'auto'
  );
