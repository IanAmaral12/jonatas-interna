-- The order feed uses Wyllian's full name; Meta campaigns use his first name.
insert into public.sellers (name)
select 'Wyllian Cristhian da Silva'
where not exists (
  select 1 from public.sellers
  where normalized_name = public.normalize_match_text('Wyllian Cristhian da Silva')
);

with wyllian as (
  select id from public.sellers
  where normalized_name = public.normalize_match_text('Wyllian Cristhian da Silva')
  order by created_at
  limit 1
)
insert into public.seller_aliases (seller_id, alias)
select wyllian.id, aliases.alias
from wyllian
cross join (values ('Wyllian'), ('Wyllian Cristhian da Silva')) as aliases(alias)
on conflict (normalized_alias) do update set seller_id = excluded.seller_id;

-- Attribute orders received before the aliases existed.
update public.orders as orders
set seller_id = sellers.id
from public.sellers as sellers
where sellers.normalized_name = public.normalize_match_text('Wyllian Cristhian da Silva')
  and public.normalize_match_text(orders.atendente) in (
    public.normalize_match_text('Wyllian'),
    public.normalize_match_text('Wyllian Cristhian da Silva')
  )
  and orders.seller_id is distinct from sellers.id;

-- Attribute stored spend and conversations without changing manual mappings.
update public.meta_campaigns as campaigns
set seller_id = sellers.id,
    mapping_source = 'auto',
    updated_at = now()
from public.sellers as sellers
where sellers.normalized_name = public.normalize_match_text('Wyllian Cristhian da Silva')
  and position(public.normalize_match_text('Wyllian') in campaigns.normalized_name) > 0
  and campaigns.mapping_source <> 'manual'
  and (campaigns.seller_id is distinct from sellers.id or campaigns.mapping_source <> 'auto');
