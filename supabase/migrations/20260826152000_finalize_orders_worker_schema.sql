alter table public.orders
  drop column if exists valor_parcial,
  drop column if exists termo;

select pgmq.create('orders_ingest_dlq');

create or replace function public.enqueue_orders_ingest_dead_letter(payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_id bigint;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'O payload da fila de erros deve ser um objeto JSON.';
  end if;

  select pgmq.send(
    queue_name => 'orders_ingest_dlq',
    msg => payload
  )
  into message_id;

  return message_id;
end;
$$;

revoke all on function public.enqueue_orders_ingest_dead_letter(jsonb)
  from public, anon, authenticated;

grant execute on function public.enqueue_orders_ingest_dead_letter(jsonb)
  to service_role;
