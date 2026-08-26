create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

create table if not exists public.orders_worker_lease (
  singleton boolean primary key default true check (singleton),
  owner_token uuid,
  locked_until timestamptz not null default '-infinity'::timestamptz
);

insert into public.orders_worker_lease (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.orders_worker_lease enable row level security;
revoke all on table public.orders_worker_lease from public, anon, authenticated;

create or replace function public.claim_orders_worker(
  requested_owner uuid,
  lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean;
begin
  update public.orders_worker_lease
  set
    owner_token = requested_owner,
    locked_until = now() + make_interval(secs => least(greatest(lease_seconds, 30), 900))
  where singleton = true
    and locked_until <= now()
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

create or replace function public.release_orders_worker(requested_owner uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  released boolean;
begin
  update public.orders_worker_lease
  set
    owner_token = null,
    locked_until = '-infinity'::timestamptz
  where singleton = true
    and owner_token = requested_owner
  returning true into released;

  return coalesce(released, false);
end;
$$;

create or replace function public.invoke_orders_worker()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_secret text;
  request_id bigint;
begin
  select decrypted_secret
  into worker_secret
  from vault.decrypted_secrets
  where name = 'orders_worker_secret'
  limit 1;

  if worker_secret is null then
    raise exception 'O segredo orders_worker_secret não foi configurado no Vault.';
  end if;

  select net.http_post(
    url := 'https://biyzmqfpxeqkittmnxpu.supabase.co/functions/v1/orders-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', worker_secret
    ),
    body := jsonb_build_object('batch_size', 100),
    timeout_milliseconds := 30000
  )
  into request_id;

  return request_id;
end;
$$;

create or replace function public.configure_orders_worker_schedule(secret_value text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_secret_id uuid;
begin
  if secret_value is null or length(secret_value) < 32 then
    raise exception 'O segredo do worker deve ter pelo menos 32 caracteres.';
  end if;

  select id
  into existing_secret_id
  from vault.decrypted_secrets
  where name = 'orders_worker_secret'
  limit 1;

  if existing_secret_id is null then
    perform vault.create_secret(
      secret_value,
      'orders_worker_secret',
      'Segredo usado pelo Cron para invocar a Edge Function orders-worker.'
    );
  else
    perform vault.update_secret(
      existing_secret_id,
      secret_value,
      'orders_worker_secret',
      'Segredo usado pelo Cron para invocar a Edge Function orders-worker.'
    );
  end if;

  perform cron.schedule(
    'process-orders-ingest',
    '* * * * *',
    'select public.invoke_orders_worker();'
  );

  return true;
end;
$$;

revoke all on function public.claim_orders_worker(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_orders_worker(uuid) from public, anon, authenticated;
revoke all on function public.invoke_orders_worker() from public, anon, authenticated;
revoke all on function public.configure_orders_worker_schedule(text) from public, anon, authenticated;

grant execute on function public.claim_orders_worker(uuid, integer) to service_role;
grant execute on function public.release_orders_worker(uuid) to service_role;
grant execute on function public.configure_orders_worker_schedule(text) to service_role;
