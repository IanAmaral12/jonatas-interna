create or replace function public.parse_skale_order_created_at(payload jsonb)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  raw_timestamp text;
  raw_date text;
  raw_time text;
begin
  raw_timestamp := nullif(btrim(payload ->> 'started_at'), '');

  if raw_timestamp is not null then
    if raw_timestamp ~* '(Z|[+-][0-9]{2}:?[0-9]{2})$' then
      return replace(raw_timestamp, ' ', 'T')::timestamptz;
    end if;

    if raw_timestamp ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}' then
      return replace(raw_timestamp, 'T', ' ')::timestamp
        at time zone 'America/Sao_Paulo';
    end if;
  end if;

  raw_date := nullif(btrim(payload ->> 'started_at_data'), '');
  raw_time := nullif(btrim(payload ->> 'started_at_hora'), '');

  if raw_date is not null and raw_time is not null then
    return (raw_date || ' ' || raw_time)::timestamp
      at time zone 'America/Sao_Paulo';
  end if;

  if raw_date is not null then
    return raw_date::date::timestamp
      at time zone 'America/Sao_Paulo';
  end if;

  return null;
exception
  when others then
    return null;
end;
$$;

alter table public.orders
  alter column data type timestamptz
  using data::timestamp at time zone 'America/Sao_Paulo';

alter table public.orders
  add column status_pagamento text,
  add column cancelado boolean not null default false;

comment on column public.orders.data is
  'Data e hora de criação do pedido, recebida no evento order_created e armazenada como timestamptz.';

comment on column public.orders.status_pagamento is
  'Status de pagamento mais recente recebido do Skale ou da transação.';

comment on column public.orders.cancelado is
  'Indica se algum status de pagamento recebido contém a palavra cancelado.';

with created_events as (
  select distinct on (archived.message #>> '{payload,skaletracking,id_venda}')
    archived.message #>> '{payload,skaletracking,id_venda}' as order_id,
    public.parse_skale_order_created_at(archived.message -> 'payload') as created_at
  from pgmq.a_orders_ingest as archived
  where archived.message #>> '{payload,status}' = 'order_created'
    and nullif(archived.message #>> '{payload,skaletracking,id_venda}', '') is not null
  order by
    archived.message #>> '{payload,skaletracking,id_venda}',
    archived.msg_id desc
)
update public.orders as orders
set data = created_events.created_at
from created_events
where orders.id = created_events.order_id
  and created_events.created_at is not null;

with payment_events as (
  select distinct on (archived.message #>> '{payload,skaletracking,id_venda}')
    archived.message #>> '{payload,skaletracking,id_venda}' as order_id,
    coalesce(
      nullif(btrim(archived.message #>> '{payload,skale,status_pagamento}'), ''),
      nullif(btrim(archived.message #>> '{payload,skaletracking,status_pagamento}'), ''),
      nullif(btrim(archived.message #>> '{payload,transaction,payment_status}'), '')
    ) as payment_status,
    concat_ws(
      ' ',
      archived.message #>> '{payload,skale,status_pagamento}',
      archived.message #>> '{payload,skaletracking,status_pagamento}',
      archived.message #>> '{payload,transaction,payment_status}'
    ) ilike '%cancelado%' as is_cancelled
  from pgmq.a_orders_ingest as archived
  where nullif(archived.message #>> '{payload,skaletracking,id_venda}', '') is not null
    and coalesce(
      nullif(btrim(archived.message #>> '{payload,skale,status_pagamento}'), ''),
      nullif(btrim(archived.message #>> '{payload,skaletracking,status_pagamento}'), ''),
      nullif(btrim(archived.message #>> '{payload,transaction,payment_status}'), '')
    ) is not null
  order by
    archived.message #>> '{payload,skaletracking,id_venda}',
    archived.msg_id desc
)
update public.orders as orders
set
  status_pagamento = payment_events.payment_status,
  cancelado = payment_events.is_cancelled
from payment_events
where orders.id = payment_events.order_id;

drop function public.parse_skale_order_created_at(jsonb);

create index orders_cpa_eligible_idx
  on public.orders (data desc, atendente)
  where cancelado = false;
