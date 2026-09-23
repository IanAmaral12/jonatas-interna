-- The upstream order feed now sends "WESLEY MEDEIROS" instead of the former full name.
-- Keep both names so the existing order trigger maps future orders as well.
with wesley as (
  select sellers.id
  from public.sellers as sellers
  join public.seller_aliases as aliases on aliases.seller_id = sellers.id
  where aliases.normalized_alias = public.normalize_match_text('Wesley')
  order by sellers.created_at
  limit 1
)
insert into public.seller_aliases (seller_id, alias)
select wesley.id, 'WESLEY MEDEIROS'
from wesley
on conflict (normalized_alias) do update
set seller_id = excluded.seller_id;

with wesley as (
  select aliases.seller_id as id
  from public.seller_aliases as aliases
  where aliases.normalized_alias = public.normalize_match_text('Wesley')
)
update public.orders as orders
set seller_id = wesley.id
from wesley
where public.normalize_match_text(orders.atendente)
    = public.normalize_match_text('WESLEY MEDEIROS')
  and orders.seller_id is distinct from wesley.id;
