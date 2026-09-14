create table public.pre_appointments (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id),
  appointment_date date not null,
  quantity integer not null check (quantity between 1 and 1000000),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 days')
);

create index pre_appointments_period_seller_idx
  on public.pre_appointments (appointment_date, seller_id);
create index pre_appointments_expiry_idx on public.pre_appointments (expires_at);

create function public.validate_pre_appointment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.seller_id is distinct from old.seller_id then
    if not exists (select 1 from public.sellers where id = new.seller_id and active) then
      raise exception 'Selecione um vendedor ativo.';
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.expires_at := new.created_at + interval '15 days';
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.expires_at := old.expires_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger validate_pre_appointment
before insert or update on public.pre_appointments
for each row execute function public.validate_pre_appointment();

alter table public.pre_appointments enable row level security;
create policy pre_appointments_read on public.pre_appointments
  for select to authenticated using (expires_at > now());
create policy pre_appointments_create on public.pre_appointments
  for insert to authenticated with check (created_by = auth.uid() and expires_at > now());
create policy pre_appointments_update on public.pre_appointments
  for update to authenticated using (expires_at > now()) with check (expires_at > now());
create policy pre_appointments_delete on public.pre_appointments
  for delete to authenticated using (expires_at > now());

revoke all on public.pre_appointments from public, anon, authenticated;
grant select, delete on public.pre_appointments to authenticated;
grant insert (seller_id, appointment_date, quantity) on public.pre_appointments to authenticated;
grant update (seller_id, appointment_date, quantity) on public.pre_appointments to authenticated;
revoke all on function public.validate_pre_appointment() from public, anon, authenticated;

-- Aggregate in the database so the dashboard is not limited by API row pagination.
create function public.get_pre_appointment_totals(p_start_date date, p_end_date date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(totals) order by totals.appointment_date, totals.seller_name), '[]'::jsonb)
  from (
    select entries.seller_id, sellers.name as seller_name, entries.appointment_date, sum(entries.quantity)::bigint as quantity
    from public.pre_appointments as entries
    join public.sellers as sellers on sellers.id = entries.seller_id
    where entries.expires_at > now()
      and entries.appointment_date between p_start_date and p_end_date
    group by entries.seller_id, sellers.name, entries.appointment_date
  ) as totals;
$$;
revoke all on function public.get_pre_appointment_totals(date, date) from public, anon, authenticated;
grant execute on function public.get_pre_appointment_totals(date, date) to authenticated;

-- Expired entries stop contributing immediately, even between cleanup runs.
create extension if not exists pg_cron;
select cron.schedule('purge-expired-pre-appointments', '0 * * * *',
  $job$delete from public.pre_appointments where expires_at <= now();$job$);

comment on table public.pre_appointments is
  'Lançamentos manuais temporários. Expiram 15 dias após a criação; editar não renova a validade.';
