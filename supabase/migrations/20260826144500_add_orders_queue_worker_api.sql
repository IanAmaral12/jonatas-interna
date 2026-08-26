create or replace function public.peek_orders_ingest_payloads(batch_size integer default 10)
returns table (
  msg_id bigint,
  read_ct bigint,
  enqueued_at timestamptz,
  message jsonb
)
language sql
security definer
set search_path = ''
as $$
  select
    queued.msg_id,
    queued.read_ct,
    queued.enqueued_at,
    queued.message
  from pgmq.q_orders_ingest as queued
  order by queued.msg_id
  limit least(greatest(batch_size, 1), 100);
$$;

create or replace function public.read_orders_ingest_payloads(
  batch_size integer default 10,
  visibility_timeout_seconds integer default 60
)
returns table (
  msg_id bigint,
  read_ct bigint,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb
)
language sql
security definer
set search_path = ''
as $$
  select
    queued.msg_id,
    queued.read_ct,
    queued.enqueued_at,
    queued.vt,
    queued.message
  from pgmq.read(
    'orders_ingest',
    greatest(visibility_timeout_seconds, 1),
    least(greatest(batch_size, 1), 100)
  ) as queued;
$$;

create or replace function public.archive_orders_ingest_payload(message_id bigint)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select pgmq.archive('orders_ingest', message_id);
$$;

revoke all on function public.peek_orders_ingest_payloads(integer) from public, anon, authenticated;
revoke all on function public.read_orders_ingest_payloads(integer, integer) from public, anon, authenticated;
revoke all on function public.archive_orders_ingest_payload(bigint) from public, anon, authenticated;

grant execute on function public.peek_orders_ingest_payloads(integer) to service_role;
grant execute on function public.read_orders_ingest_payloads(integer, integer) to service_role;
grant execute on function public.archive_orders_ingest_payload(bigint) to service_role;
