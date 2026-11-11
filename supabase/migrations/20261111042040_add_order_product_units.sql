alter table public.orders
  add column product_units integer check (product_units > 0);

comment on column public.orders.product_units is
  'Total de unidades dos itens do pedido, preservado do webhook para custos financeiros.';

with candidate_messages as (
  select
    archived.message #>> '{payload,skaletracking,id_venda}' as order_id,
    archived.message #>> '{payload,status}' as event_status,
    archived.message #> '{payload,product,products}' as products,
    archived.msg_id
  from pgmq.a_orders_ingest as archived
  where archived.message #>> '{payload,skaletracking,id_venda}' is not null
), valid_candidates as (
  select
    candidate.order_id,
    candidate.event_status,
    candidate.msg_id,
    jsonb_array_length(candidate.products) as item_count,
    (
      select count(*)
      from jsonb_array_elements(candidate.products) as product
      where product ->> 'quantity' ~ '^[1-9][0-9]{0,8}$'
    ) as valid_item_count,
    (
      select sum((product ->> 'quantity')::bigint)
      from jsonb_array_elements(candidate.products) as product
      where product ->> 'quantity' ~ '^[1-9][0-9]{0,8}$'
    ) as units
  from candidate_messages as candidate
  where jsonb_typeof(candidate.products) = 'array'
    and jsonb_array_length(candidate.products) > 0
), chosen as (
  select distinct on (order_id)
    order_id,
    units::integer as product_units
  from valid_candidates
  where item_count = valid_item_count
    and units between 1 and 2147483647
  order by order_id, (event_status = 'order_created') desc, msg_id
)
update public.orders as orders
set product_units = chosen.product_units
from chosen
where orders.id = chosen.order_id
  and orders.product_units is null;
