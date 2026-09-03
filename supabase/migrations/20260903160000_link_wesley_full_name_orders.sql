with wesley as (
  select sellers.id
  from public.sellers as sellers
  join public.seller_aliases as aliases on aliases.seller_id = sellers.id
  where aliases.normalized_alias = public.normalize_match_text('Wesley')
  order by sellers.created_at
  limit 1
)
update public.sellers as sellers
set name = 'Wesley Mele de Medeiros'
from wesley
where sellers.id = wesley.id
  and sellers.name is distinct from 'Wesley Mele de Medeiros';

with wesley as (
  select sellers.id
  from public.sellers as sellers
  join public.seller_aliases as aliases on aliases.seller_id = sellers.id
  where aliases.normalized_alias = public.normalize_match_text('Wesley')
  order by sellers.created_at
  limit 1
)
insert into public.seller_aliases (seller_id, alias)
select wesley.id, 'WESLEY MELE DE MEDEIROS'
from wesley
on conflict (normalized_alias) do update
set seller_id = excluded.seller_id;

with wesley as (
  select sellers.id
  from public.sellers as sellers
  join public.seller_aliases as aliases on aliases.seller_id = sellers.id
  where aliases.normalized_alias = public.normalize_match_text('Wesley')
  order by sellers.created_at
  limit 1
)
update public.orders as orders
set seller_id = wesley.id
from wesley
where orders.atendente is not null
  and public.normalize_match_text(orders.atendente)
    = public.normalize_match_text('WESLEY MELE DE MEDEIROS')
  and orders.seller_id is distinct from wesley.id;
