alter table public.order_financial_snapshots
  drop constraint order_financial_snapshots_received_amount_source_check;
alter table public.order_financial_snapshots
  add constraint order_financial_snapshots_received_amount_source_check
  check (received_amount_source in ('paid_amount','total_price','skale_payments'));

create table public.order_payment_reconciliations (
  id bigint generated always as identity primary key,
  order_id text not null references public.orders(id),
  payment_status text not null check (payment_status in ('paid','partial')),
  received_amount numeric not null check (received_amount >= 0 and received_amount = round(received_amount,2)),
  payments jsonb not null check (jsonb_typeof(payments)='array'),
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (order_id, observed_at)
);
alter table public.order_payment_reconciliations enable row level security;
revoke all on public.order_payment_reconciliations from public, anon, authenticated;
grant select on public.order_payment_reconciliations to service_role;
create policy "Service reads payment reconciliation evidence" on public.order_payment_reconciliations
  for select to service_role using (true);

create function public.reconcile_confirmed_order_payments(
  p_order_id text, p_payment_status text, p_received_amount numeric,
  p_payments jsonb, p_observed_at timestamptz
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  saved public.order_financial_snapshots;
  status text := private.financial_payment_status(p_payment_status);
  confirmed numeric;
  paid_date date;
  reconciliation_id bigint;
  version jsonb;
  existing public.order_payment_reconciliations;
begin
  if status is null or status not in ('paid','partial') then
    raise exception 'Reconciliation requires a paid or partial payment status';
  end if;
  if p_received_amount is null or p_received_amount < 0
    or p_received_amount > 999999999999.99 or p_received_amount <> round(p_received_amount,2) then
    raise exception 'Received amount must have at most two decimal places';
  end if;
  if p_observed_at is null or p_observed_at > clock_timestamp()+interval '5 minutes' then
    raise exception 'Invalid payment observation timestamp';
  end if;
  if p_payments is null or jsonb_typeof(p_payments) <> 'array' then
    raise exception 'Payment evidence must be an array';
  end if;
  if jsonb_array_length(p_payments)=0 or jsonb_array_length(p_payments)>200 then
    raise exception 'Payment evidence must contain between one and 200 payments';
  end if;
  if exists (select 1 from jsonb_array_elements(p_payments) leg
    where jsonb_typeof(leg) <> 'object'
      or coalesce(leg->>'id','') !~ '^[1-9][0-9]{0,17}$'
      or jsonb_typeof(leg->'amount') is distinct from 'number'
      or nullif(btrim(leg->>'status'),'') is null) then
    raise exception 'Invalid payment id, status or amount in evidence';
  end if;
  if exists (select 1 from jsonb_array_elements(p_payments) leg
    where (leg->>'amount')::numeric < 0
      or (leg->>'amount')::numeric <> round((leg->>'amount')::numeric,2)) then
    raise exception 'Payment amount must have at most two decimal places';
  end if;
  if (select count(*) from jsonb_array_elements(p_payments)) <>
    (select count(distinct leg->>'id') from jsonb_array_elements(p_payments) leg) then
    raise exception 'Duplicate payment ids in evidence';
  end if;
  select sum((leg->>'amount')::numeric),max(nullif(leg->>'paid_at','')::date)
  into confirmed,paid_date from jsonb_array_elements(p_payments) leg
  where private.financial_payment_status(leg->>'status')='paid';
  if confirmed is null or confirmed <> p_received_amount then
    raise exception 'Confirmed payment sum does not match the received total';
  end if;

  -- Serializing imports prevents one external payment id being assigned to two orders.
  perform pg_catalog.pg_advisory_xact_lock(684203719);
  select * into saved from public.order_financial_snapshots where order_id=p_order_id for update;
  if not found then raise exception 'Order financial snapshot not found'; end if;
  if exists (select 1 from public.order_payment_reconciliations audit
    cross join lateral jsonb_array_elements(audit.payments) previous
    cross join lateral jsonb_array_elements(p_payments) incoming
    where audit.order_id<>p_order_id and previous->>'id'=incoming->>'id') then
    raise exception 'Payment id is already assigned to another order';
  end if;
  if (saved.field_versions#>>'{payment_status,at}')::timestamptz > p_observed_at
    or (saved.field_versions#>>'{received_amount,at}')::timestamptz > p_observed_at then
    raise exception 'A newer financial fact exists; refresh the payment source';
  end if;
  select * into existing from public.order_payment_reconciliations
    where order_id=p_order_id and observed_at=p_observed_at;
  if found then
    if (existing.payment_status,existing.received_amount,existing.payments)
      is distinct from (status,p_received_amount,p_payments) then
      raise exception 'Conflicting evidence at the same observation timestamp';
    end if;
    return existing.id;
  end if;
  insert into public.order_payment_reconciliations(order_id,payment_status,received_amount,payments,observed_at)
    values(p_order_id,status,p_received_amount,p_payments,p_observed_at) returning id into reconciliation_id;
  version := jsonb_build_object('at',p_observed_at,'id',saved.source_message_id,
    'source','skale_payments','reconciliation_id',reconciliation_id);
  update public.order_financial_snapshots set payment_status=status,
    received_amount=p_received_amount,received_payment_status=status,
    received_amount_source='skale_payments',has_payment_evidence=true,
    source_updated_at=greatest(source_updated_at,p_observed_at),
    field_versions=jsonb_set(jsonb_set(field_versions,'{payment_status}',version),'{received_amount}',version)
  where order_id=p_order_id;
  update public.orders set status_pagamento=case when status='paid' then 'Pago' else 'Pago Parcial' end,
    data_pagamento=coalesce(paid_date,data_pagamento) where id=p_order_id;
  return reconciliation_id;
end;
$$;
revoke all on function public.reconcile_confirmed_order_payments(text,text,numeric,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.reconcile_confirmed_order_payments(text,text,numeric,jsonb,timestamptz) to service_role;

-- A gross-price fallback must never replace a verified payment total.
create or replace function public.record_order_financial_snapshot(
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
  if received is not null and payment = merged->>'payment_status'
    and (saved.received_amount_source is distinct from 'skale_payments'
      or received_source is distinct from 'total_price') then
    previous_at := (versions#>>'{received_amount,at}')::timestamptz;
    previous_id := (versions#>>'{received_amount,id}')::bigint;
    newer := previous_at is null or (event_at, p_message_id) >= (previous_at, previous_id);
    if saved.received_amount is null or saved.received_payment_status is distinct from payment
      or (newer and not (saved.received_amount_source in ('paid_amount','skale_payments') and received_source = 'total_price')) then
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
  -- The worker writes commercial fields before this merge; restore the protected payment state.
  if saved.payment_status in ('paid','partial') then
    update public.orders set status_pagamento=case when saved.payment_status='paid' then 'Pago' else 'Pago Parcial' end
    where id=p_order_id and status_pagamento is distinct from
      case when saved.payment_status='paid' then 'Pago' else 'Pago Parcial' end;
  end if;
end;
$$;
notify pgrst, 'reload schema';
