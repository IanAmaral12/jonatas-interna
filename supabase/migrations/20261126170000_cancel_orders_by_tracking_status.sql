-- Skale reports most cancellations in the tracking status, not in the payment status.
comment on column public.orders.cancelado is
  'Indica se o status de pagamento ou de rastreio mais recente contém a palavra cancelado.';

update public.orders
set cancelado = true
where not cancelado
  and status_rastreio ilike '%cancelado%';
