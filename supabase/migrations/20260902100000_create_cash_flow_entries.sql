create table public.cash_flow_entries (
  id uuid primary key default gen_random_uuid(),
  author text not null check (btrim(author) <> ''),
  amount numeric(14, 2) not null check (amount > 0),
  description text not null check (btrim(description) <> ''),
  entry_type text not null check (entry_type in ('entrada', 'saida')),
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table public.cash_flow_entries is
  'Lançamentos manuais de entrada e saída do fluxo de caixa da operação.';
comment on column public.cash_flow_entries.amount is
  'Valor positivo do lançamento; o sinal contábil é determinado por entry_type.';
comment on column public.cash_flow_entries.created_by is
  'Usuário autenticado responsável por registrar o lançamento.';

create index cash_flow_entries_created_at_idx
  on public.cash_flow_entries (created_at desc);
create index cash_flow_entries_type_created_at_idx
  on public.cash_flow_entries (entry_type, created_at desc);

alter table public.cash_flow_entries enable row level security;

create policy "Authenticated users can read cash flow"
on public.cash_flow_entries
for select
to authenticated
using (true);

create policy "Authenticated users can create cash flow entries"
on public.cash_flow_entries
for insert
to authenticated
with check (created_by = (select auth.uid()));

create policy "Authenticated users can delete cash flow entries"
on public.cash_flow_entries
for delete
to authenticated
using (true);

revoke all on table public.cash_flow_entries from public, anon;
grant select, insert, delete on table public.cash_flow_entries to authenticated;
