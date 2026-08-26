create table public.orders (
  id text primary key check (btrim(id) <> ''),
  atendente text,
  data date,
  nome_cliente text,
  contato_cliente text,
  valor numeric(12, 2),
  observacao text,
  tratamento text,
  documento text,
  valor_parcial numeric(12, 2),
  termo text,
  plataforma text,
  data_pagamento date,
  codigo_rastreio text,
  status_rastreio text
);

comment on table public.orders is
  'Pedidos recebidos por integração com plataformas externas.';

comment on column public.orders.id is
  'Identificador textual do pedido recebido via webhook da plataforma de origem.';

create index orders_data_idx on public.orders (data desc);
create index orders_data_pagamento_idx on public.orders (data_pagamento desc);
create index orders_atendente_idx on public.orders (atendente);
create index orders_plataforma_idx on public.orders (plataforma);
create index orders_status_rastreio_idx on public.orders (status_rastreio);

alter table public.orders enable row level security;
