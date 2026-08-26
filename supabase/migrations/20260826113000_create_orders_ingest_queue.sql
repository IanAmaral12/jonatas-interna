create extension if not exists pgmq;

select pgmq.create('orders_ingest');

create or replace function public.enqueue_order_payload(payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_id bigint;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'O payload da fila deve ser um objeto JSON.';
  end if;

  select pgmq.send(
    queue_name => 'orders_ingest',
    msg => payload
  )
  into message_id;

  return message_id;
end;
$$;

comment on function public.enqueue_order_payload(jsonb) is
  'Adiciona um payload recebido por webhook à fila durável orders_ingest.';

revoke all on function public.enqueue_order_payload(jsonb) from public;
revoke all on function public.enqueue_order_payload(jsonb) from anon;
revoke all on function public.enqueue_order_payload(jsonb) from authenticated;
grant execute on function public.enqueue_order_payload(jsonb) to service_role;
