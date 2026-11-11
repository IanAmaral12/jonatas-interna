create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.financial_cents(value jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(value) in ('number', 'string')
    and (value #>> '{}') ~ '^[0-9]{1,14}$'
    then (value #>> '{}')::numeric / 100 end;
$$;

create function private.financial_timestamp(value text) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  if value !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  if value ~ '(Z|[+-]\d{2}:?\d{2})$' then return value::timestamptz; end if;
  return value::timestamp at time zone 'America/Sao_Paulo';
exception when others then return null;
end;
$$;

create function private.financial_payment_status(value text) returns text
language sql immutable set search_path = '' as $$
  select case lower(btrim(value))
    when 'pago' then 'paid'
    when 'paid' then 'paid'
    when 'parcial' then 'partial'
    when 'pago parcial' then 'partial'
    when 'pago_parcial' then 'partial'
    when 'partial' then 'partial'
    else nullif(nullif(lower(btrim(value)), ''), '-') end;
$$;

create table public.order_financial_snapshots (
  order_id text primary key references public.orders(id) on delete cascade,
  payment_status text,
  shipping_status text,
  received_amount numeric(14,2) check (received_amount >= 0),
  received_amount_source text check (received_amount_source in ('paid_amount', 'total_price')),
  received_payment_status text,
  payment_fee numeric(14,2) check (payment_fee >= 0),
  external_commission numeric(14,2) check (external_commission >= 0),
  payment_platform text,
  has_payment_evidence boolean not null default false,
  source_updated_at timestamptz not null,
  source_message_id bigint not null,
  field_versions jsonb not null default '{}'
);
alter table public.order_financial_snapshots enable row level security;
revoke all on public.order_financial_snapshots from public, anon, authenticated;
grant select, insert, update on public.order_financial_snapshots to service_role;
create policy "Service manages financial snapshots" on public.order_financial_snapshots
  for all to service_role using (true) with check (true);

-- The same parser and field-level version merge serve archive recovery and live events.
create function public.record_order_financial_snapshot(
  p_order_id text, p_payload jsonb, p_message_id bigint, p_received_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare
  saved public.order_financial_snapshots;
  incoming jsonb;
  merged jsonb;
  versions jsonb;
  field text;
  payment text;
  received numeric;
  received_source text;
  event_at timestamptz;
  previous_at timestamptz;
  previous_id bigint;
  newer boolean;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_message_id is null or p_received_at is null then
    raise exception 'Snapshot requires payload, message id and receipt timestamp';
  end if;
  event_at := coalesce(
    private.financial_timestamp(p_payload->>'updated_at'),
    private.financial_timestamp((p_payload->>'updated_at_data') || 'T' || coalesce(p_payload->>'updated_at_hora','00:00:00')),
    private.financial_timestamp(p_payload#>>'{skaletracking,updated_at}'),
    private.financial_timestamp((p_payload#>>'{skaletracking,updated_at_data}') || 'T' || coalesce(p_payload#>>'{skaletracking,updated_at_hora}','00:00:00')),
    private.financial_timestamp(p_payload#>>'{transaction,updated_at}'),
    private.financial_timestamp((p_payload#>>'{transaction,updated_at_data}') || 'T' || coalesce(p_payload#>>'{transaction,updated_at_hora}','00:00:00')),
    p_received_at);
  payment := coalesce(
    private.financial_payment_status(p_payload#>>'{skale,status_pagamento}'),
    private.financial_payment_status(p_payload#>>'{skaletracking,status_pagamento}'),
    private.financial_payment_status(p_payload#>>'{transaction,payment_status}')
  );
  if payment in ('paid', 'partial') then
    received := private.financial_cents(p_payload#>'{transaction,paid_amount}');
    if received is not null then received_source := 'paid_amount';
    elsif payment = 'paid' and (p_payload#>'{transaction,paid_amount}' is null
      or p_payload#>'{transaction,paid_amount}' = 'null'::jsonb) then
      received := private.financial_cents(p_payload#>'{transaction,total_price}');
      if received is not null then received_source := 'total_price'; end if;
    end if;
  end if;
  incoming := jsonb_build_object(
    'payment_status', payment,
    'shipping_status', nullif(nullif(btrim(p_payload#>>'{skaletracking,status_entrega}'), ''), '-'),
    'payment_fee', private.financial_cents(p_payload#>'{transaction,acquirer_cost}'),
    'external_commission', private.financial_cents(p_payload#>'{transaction,affiliate_earned}'),
    'payment_platform', coalesce(nullif(nullif(btrim(p_payload#>>'{skaletracking,plataforma}'), ''), '-'),
      nullif(nullif(btrim(p_payload#>>'{transaction,payment_platform}'), ''), '-'))
  );
  insert into public.order_financial_snapshots(order_id, source_updated_at, source_message_id)
    values (p_order_id, event_at, p_message_id) on conflict (order_id) do nothing;
  select * into strict saved from public.order_financial_snapshots where order_id = p_order_id for update;
  merged := to_jsonb(saved);
  versions := saved.field_versions;
  foreach field in array array['payment_status','shipping_status','payment_fee','external_commission','payment_platform'] loop
    if incoming->field <> 'null'::jsonb then
      previous_at := (versions#>>array[field,'at'])::timestamptz;
      previous_id := (versions#>>array[field,'id'])::bigint;
      newer := previous_at is null or (event_at, p_message_id) >= (previous_at, previous_id);
      if merged->field = 'null'::jsonb or newer then
        merged := jsonb_set(merged, array[field], incoming->field);
        versions := jsonb_set(versions, array[field], jsonb_build_object('at',event_at,'id',p_message_id));
      end if;
    end if;
  end loop;
  if received is not null and payment = merged->>'payment_status' then
    previous_at := (versions#>>'{received_amount,at}')::timestamptz;
    previous_id := (versions#>>'{received_amount,id}')::bigint;
    newer := previous_at is null or (event_at, p_message_id) >= (previous_at, previous_id);
    if saved.received_amount is null or saved.received_payment_status is distinct from payment
      or (newer and not (saved.received_amount_source = 'paid_amount' and received_source = 'total_price')) then
      merged := merged || jsonb_build_object('received_amount',received,
        'received_amount_source',received_source,'received_payment_status',payment);
      versions := jsonb_set(versions, '{received_amount}', jsonb_build_object('at',event_at,'id',p_message_id));
    end if;
  end if;
  saved := jsonb_populate_record(saved, merged);
  update public.order_financial_snapshots set
    payment_status = saved.payment_status, shipping_status = saved.shipping_status,
    received_amount = saved.received_amount, received_amount_source = saved.received_amount_source,
    received_payment_status = saved.received_payment_status,
    payment_fee = saved.payment_fee, external_commission = saved.external_commission,
    payment_platform = saved.payment_platform,
    has_payment_evidence = saved.has_payment_evidence or coalesce(payment in ('paid','partial','chargeback','estornado','reembolsado','refunded'), false),
    field_versions = versions,
    source_updated_at = case when (event_at,p_message_id) > (saved.source_updated_at,saved.source_message_id)
      then event_at else saved.source_updated_at end,
    source_message_id = case when (event_at,p_message_id) > (saved.source_updated_at,saved.source_message_id)
      then p_message_id else saved.source_message_id end
  where order_id = p_order_id;
end;
$$;

create function public.reconcile_order_financial_snapshots(p_after_message_id bigint default 0)
returns bigint language plpgsql security definer set search_path = '' as $$
declare item record; watermark bigint;
begin
  select coalesce(max(msg_id), p_after_message_id) into watermark from pgmq.a_orders_ingest;
  for item in
    select archive.msg_id, archive.enqueued_at, archive.message->'payload' as payload,
      orders.id as order_id,
      coalesce(private.financial_timestamp(archive.message->>'received_at'), archive.enqueued_at) as received_at
    from pgmq.a_orders_ingest archive
    join public.orders orders on orders.id = btrim(archive.message#>>'{payload,skaletracking,id_venda}')
    where archive.msg_id > p_after_message_id and archive.msg_id <= watermark
      and archive.message#>>'{payload,type}' = 'order'
      and archive.message#>'{payload,_test}' is distinct from 'true'::jsonb
    order by archive.msg_id
  loop
    perform public.record_order_financial_snapshot(item.order_id,item.payload,item.msg_id,item.received_at);
  end loop;
  return watermark;
end;
$$;
revoke all on function private.financial_cents(jsonb), private.financial_timestamp(text),
  private.financial_payment_status(text) from public, anon, authenticated;
revoke all on function public.record_order_financial_snapshot(text,jsonb,bigint,timestamptz),
  public.reconcile_order_financial_snapshots(bigint) from public, anon, authenticated;
grant execute on function public.record_order_financial_snapshot(text,jsonb,bigint,timestamptz),
  public.reconcile_order_financial_snapshots(bigint) to service_role;

select public.reconcile_order_financial_snapshots();
notify pgrst, 'reload schema';
