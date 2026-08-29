# Nutra X1 — Autenticação com Supabase

Tela de autenticação em React, Vite e Supabase Auth, inteiramente em português.

## Configuração

1. No painel do Supabase, abra **Project Settings > API**.
2. Preencha o arquivo `.env`:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=SUA_CHAVE_PUBLICA
```

3. Em **Authentication > URL Configuration**, adicione a URL local `http://localhost:5173` em **Redirect URLs**.

## Executar

```bash
npm install
npm run dev
```

## Recursos incluídos

- Login com e-mail e senha para usuários criados pelo administrador
- Recuperação e atualização de senha
- Persistência e observação da sessão
- Encerramento de sessão
- Mensagens de erro em português
- Layout responsivo e acessível
- Área autenticada com sidebar e rota inicial de Dashboard
- Temas claro e escuro com preferência persistida no navegador

## Banco de dados

As alterações do banco ficam versionadas em `supabase/migrations`. A migração inicial cria a tabela `public.orders` para receber pedidos de plataformas externas. O campo `id` é textual e deve receber o identificador enviado pelo webhook.

A tabela utiliza Row Level Security sem políticas públicas por padrão. Integrações de backend podem gravar com uma chave de servidor; políticas de leitura para usuários autenticados devem ser adicionadas conforme as regras de acesso do dashboard.

### Entrada de pedidos por webhook

A Edge Function pública `orders-webhook` recebe objetos JSON via `POST` e os armazena na fila durável `orders_ingest`, baseada em PGMQ. Cada mensagem preserva o payload original e adiciona `request_id`, `received_at` e `source`.

Faça o deploy sem verificação de JWT:

```bash
npx supabase functions deploy orders-webhook --project-ref biyzmqfpxeqkittmnxpu --no-verify-jwt --use-api
```

O endpoint não exige autenticação. Os cabeçalhos opcionais `x-webhook-id` e `x-webhook-source` permitem identificar a entrega e a plataforma de origem. Por segurança operacional, somente requisições `POST` com objetos JSON de até 1 MB são aceitas.

### Worker de pedidos

A Edge Function privada `orders-worker` lê até 100 mensagens da fila por execução. Eventos `order_created` inserem uma nova linha usando `skaletracking.id_venda` como chave; os demais eventos apenas atualizam um pedido existente. Reenvios de criação são tratados de forma idempotente.

O valor do pedido é normalizado de centavos para reais a partir de `product.price`. Mensagens inválidas ou eventos de atualização sem uma criação anterior são preservados na fila `orders_ingest_dlq`. Mensagens processadas com sucesso são arquivadas pelo PGMQ.

O Supabase Cron invoca o worker automaticamente uma vez por minuto. Um lease no Postgres impede execuções concorrentes, e o segredo de invocação fica criptografado no Supabase Vault.

| Coluna em `orders` | Campo do payload |
| --- | --- |
| `id` | `skaletracking.id_venda` |
| `atendente` | `skaletracking.usuario_responsavel` |
| `data` | `started_at` ou `started_at_data` + `started_at_hora`, somente no `order_created` |
| `nome_cliente` | `customer.name` |
| `contato_cliente` | `customer.phone` ou `customer.email` |
| `valor` | `product.price / 100` |
| `observacao` | `skaletracking.observacao` |
| `tratamento` | `product.name` |
| `documento` | `customer.doc` |
| `plataforma` | `skaletracking.plataforma` |
| `data_pagamento` | `transaction.paid_at_data` ou `transaction.paid_at` |
| `codigo_rastreio` | `shipping.tracking_code` |
| `status_rastreio` | `skaletracking.status_entrega` |
| `status_pagamento` | `skale.status_pagamento`, `skaletracking.status_pagamento` ou `transaction.payment_status` |

O campo `orders.data` é um `timestamptz`. Datas sem offset explícito enviadas pelo Skale são interpretadas em `America/Sao_Paulo`. O campo `orders.cancelado` é atualizado quando algum status de pagamento contém `cancelado`; pedidos cancelados ficam fora do denominador do CPA.

### Meta Ads e CPA

A Edge Function privada `meta-ads-sync` usa a Graph API v26 para consultar as sete contas configuradas nos dois tokens, buscar Insights no nível de campanha e percorrer toda a paginação. A coleta usa `hourly_stats_aggregated_by_advertiser_time_zone`; cada retrato diário preenchido é substituído atomicamente, sem calcular diferenças entre totais acumulados. Respostas com `data: []` não alteram os dados existentes.

O banco preserva moeda, fuso da conta, hora local da Meta e o instante equivalente em UTC. Campanhas são relacionadas aos vendedores por aliases normalizados e o dashboard calcula o CPA como investimento dividido por pedidos não cancelados no mesmo período.

Custos originais ficam registrados em `spend`, enquanto `spend_usd` e `spend_brl` preservam os dois valores convertidos. A taxa USD/BRL é obtida pela API pública Frankfurter v2 com o provedor `BCB` (PTAX de fechamento), e sua data fica gravada junto ao insight. O frontend sempre usa `spend_brl`.

### Métricas comerciais

O dashboard cruza mídia e pedidos pela data de criação do pedido e pelo vendedor normalizado. As definições atuais são:

- **Lead:** conversa por mensagem iniciada informada em
  `actions[action_type=onsite_conversion.messaging_conversation_started_7d]`.
- **Agendamento:** qualquer pedido com `cancelado = false`.
- **CPL:** investimento convertido em BRL dividido pelas conversas iniciadas.
- **Faturamento:** soma de `orders.valor` dos agendamentos criados no período.
- **Conversão:** agendamentos divididos pelos leads.
- **ROAS:** faturamento dividido pelo investimento convertido em BRL.
- **Ticket médio:** faturamento dividido pela quantidade de agendamentos.

Pedidos não cancelados continuam sendo tratados como agendamentos para o cálculo de CPA. As métricas são retornadas pelo RPC `get_cpa_dashboard`, tanto no consolidado geral quanto por vendedor.

As conversas são armazenadas separadamente em `meta_campaign_daily_actions`, sem
alterar os insights horários de investimento. A Edge Function também aceita um
backfill idempotente e privado com o corpo abaixo (máximo de 31 dias):

```json
{
  "mode": "backfill",
  "start_date": "2026-08-26",
  "end_date": "2026-08-27"
}
```

O backfill exige o header `x-worker-secret`, atualiza somente as ações diárias e
trata uma resposta `data: []` como operação sem alteração.

Para carregar insights horários e ações de um período passado sem afetar outras
contas, use o modo `historical_backfill` com a lista explícita de IDs:

```json
{
  "mode": "historical_backfill",
  "start_date": "2026-08-23",
  "end_date": "2026-08-29",
  "account_ids": ["1161460945974128"]
}
```

Nesse modo, cada dia em USD usa a PTAX histórica do BCB correspondente — ou a
última cotação disponível para finais de semana. O limite continua sendo 31 dias.

Para ativar a integração, cadastre `META_ACCESS_TOKEN_1` e `META_ACCESS_TOKEN_2` nos secrets do Supabase e execute:

```powershell
.\scripts\configure-meta-ads.ps1
```

O script publica a função, executa a primeira sincronização e agenda novas coletas a cada 10 minutos. Tokens nunca devem ser adicionados ao Git ou expostos em variáveis `VITE_*`.
