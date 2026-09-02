alter table public.cash_flow_entries
  rename column author to responsible;

alter table public.cash_flow_entries
  rename constraint cash_flow_entries_author_check
  to cash_flow_entries_responsible_not_blank_check;

comment on column public.cash_flow_entries.responsible is
  'Responsável operacional informado manualmente no lançamento.';
