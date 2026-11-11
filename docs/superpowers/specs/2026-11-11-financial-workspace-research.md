# Espaço financeiro: comparação com Wellington e proposta

## Objetivo solicitado

Organizar o financeiro do Interna em três telas: lançamento de custos, ranking de vendedores com evolução até o ponto de equilíbrio e dashboard financeiro. Os custos surgem com o agendamento; a receita e o lucro dependem dos pagamentos confirmados. A informação apresentada continua sendo financeira.

## Fontes verificadas em 11/11/2026

- Repositório de referência: `C:/projects/backend-wellington-novo`.
- Ranking vigente: `supabase/migrations/20261002010000_paid_order_tax_allocation.sql` na referência.
- Custos e extrato: `20261001010000_manual_costs.sql` e `20261002020000_unified_cost_statement.sql` na referência.
- Taxas e pagamentos: `20260916020000_skale_payment_signal_worker.sql` e `20260914200000_dashboard_real_paid_affiliate_commission.sql` na referência.
- Projeto Wellington/Afiliados: `saghdlegtllzloigtthj`, identificado no README e confirmado remotamente como Afiliados. Após o MCP negar acesso, o usuário autorizou uma credencial alternativa. A API Management confirmou as funções publicadas e os campos financeiros da fila em consultas somente leitura. A credencial não foi gravada no repositório.
- Projeto Interna: `biyzmqfpxeqkittmnxpu`, organização Jonatas. Consultas somente leitura a `orders` e `pgmq.a_orders_ingest`; nenhuma mensagem foi consumida ou reprocessada.

## Regras observadas no Wellington

- O ranking seleciona pedidos pela data de agendamento, inclusive quando o pagamento ocorre depois. O mês é civil em `America/Sao_Paulo`.
- Frete incide sobre os agendamentos não cancelados. Fabricação incide sobre pedidos não cancelados e não devolvidos. A devolução mantém o frete e recupera o custo de fabricação.
- A receita líquida do ranking usa a comissão do produtor registrada para pedidos `Pago` ou `Parcial`. Esse líquido já desconta a comissão externa do afiliado e a taxa de pagamento.
- A taxa Skale é R$ 0,50 por pedido, inclusive cancelados, e aparece separadamente no dashboard.
- O imposto efetivamente pago é lançado por mês e rateado no ranking pela quantidade de pedidos pagos de cada afiliado. Os centavos restantes são distribuídos de forma determinística. Sem pedidos pagos, o imposto fica fora do rateio.
- Salários e outros lançamentos manuais sem vínculo com afiliado afetam o consolidado, não o ranking individual.
- O dashboard desconta frete, fabricação, comissão externa do afiliado, Skale, taxas de pagamento, imposto e custos manuais da receita recebida.

## Diferenças que exigem adaptação

1. O Interna já tem salário por vendedor e mês, comissão percentual sobre faturamento agendado com vigência e investimento em tráfego por vendedor. Essas parcelas devem continuar no custo direto do vendedor.
2. O usuário confirmou que o novo financeiro deve incluir o valor efetivamente recebido dos pagamentos parciais, além de `Pago`.
3. A fabricação do Interna continua em R$ 6,90 por unidade e o frete em R$ 30 por pedido. Os custos por código de produto do Wellington não se aplicam aos valores acordados para o Interna.
4. A taxa de pagamento do Wellington é calculada por `total_price - producer_earned - affiliate_earned`, todos convertidos de centavos. Essa fórmula não pode ser copiada cegamente: os ganhos do produtor/afiliado aparecem zerados na maior parte dos payloads do Interna.
5. O Interna recebe `transaction.acquirer_cost`, em centavos, nos eventos de pagamento. Exemplo financeiro observado: pedido de R$ 447,00 com custo de adquirência de R$ 22,31. A taxa deve substituir o retrato anterior do pedido, sem ser somada a cada evento.
6. `transaction.paid_amount` contém o valor efetivamente recebido e pode divergir do valor agendado. Sua disponibilidade histórica precisa ser reconciliada antes de trocar a base da receita atual.
7. Os valores de `interest_amount` não são automaticamente outra taxa a subtrair: a origem confirmada do custo de adquirência é `acquirer_cost`.
8. O ranking e o dashboard do Wellington não fecham integralmente: o ranking não subtrai explicitamente Skale e custos gerais. O Interna deve conciliar as parcelas, com despesas gerais identificadas à parte.
9. Falta de taxa não equivale a taxa zero. A cobertura histórica por plataforma deve orientar o backfill e as pendências. Não se deve inventar um percentual para os pedidos antigos.
10. Os flags de cancelamento do Interna nem sempre coincidem com `status_rastreio`; a classificação financeira precisa ser definida com os valores reais da origem, preservando as métricas comerciais existentes.
11. A comissão externa `transaction.affiliate_earned`, se existir, precisa ser auditada e identificada separadamente da comissão interna configurada para o vendedor. Usar recebimento bruto sem reconhecer uma comissão externa efetivamente cobrada inflaria o lucro.

## Resultado da auditoria histórica do Interna

Os dados estavam recebendo novos eventos durante a análise; as contagens abaixo são fotografias da consulta, não totais permanentes.

- Foram encontrados 1.976 pedidos atualmente `Pago`: 853 PagarMe, 7 Payt, 790 Pagamento Interno, 223 HG e 103 sem plataforma significativa.
- Entre os 860 pagos externos PagarMe/Payt, 577 não tinham `acquirer_cost` numérico em nenhum evento recuperável. A busca recursiva de outros campos financeiros não encontrou uma taxa alternativa.
- Não houve taxa zero explícita na auditoria: 303 pedidos tinham adquirência numérica, sempre positiva. Dois pedidos classificados mais recentemente como Pagamento Interno também tinham adquirência histórica positiva. Portanto, o nome atual da plataforma sozinho não prova isenção.
- Todos os 1.976 pagos tinham `transaction.total_price` em um evento que confirmava pagamento. Em 86 pedidos, esse valor diferia do preço agendado.
- Desses pagos, 645 tinham `paid_amount` numérico; em 16 casos, ele diferia de `total_price`. Proposta: usar o recebido explícito quando disponível e o `total_price` do evento pago como fallback histórico, como faz a referência. Para parciais, nunca usar o preço integral como substituto de um recebimento ausente.
- Há um pedido pago com comissão externa de R$ 363,67. O custo externo deve ser identificado separadamente da comissão percentual interna.
- Foram encontrados 85 pedidos `Devolvido`, 117 `Em Devolução`, seis com rastreio exatamente `Cancelado` e flag `cancelado=false`, e dois com `cancelado=true`. Estados de taxa de cancelamento não equivalem a cancelamento.

## Organização proposta

### Custos

- Mês de competência visível e preservado ao navegar entre as três telas.
- Remuneração por vendedor: salário lançado somente naquele mês e percentual de comissão vigente. Editar o vendedor a partir de uma lista, com indicação exata da pendência.
- Lançamentos de imposto efetivamente pago e outras despesas gerais, como na referência, com descrição, valor e data/competência. Salários de vendedores não devem ser lançados novamente como despesa geral.
- Extrato do mês com criação, edição e exclusão dos lançamentos manuais. Regras automáticas visíveis: fabricação, frete e Skale. Tráfego e adquirência são importados.

### Ranking de vendedores

- Ordenação inicial por lucro confirmado decrescente.
- Receita agendada, receita recebida, custo total, lucro confirmado e margem; composição dos custos disponível nos detalhes. Margem confirmada é lucro confirmado dividido pela receita recebida; sem recebimento, exibir margem indisponível e manter o prejuízo em reais.
- Duas barras na mesma escala: custo acumulado e receita recebida. Mostrar percentual coberto, quanto falta e o estado “Se pagou”, com o excedente em reais.
- Salário, comissão interna, fabricação, frete, tráfego, Skale, adquirência e eventual comissão externa vinculados ao vendedor entram uma vez no custo. Imposto mensal é atribuído ao mês do agendamento e rateado pela quantidade de pedidos pagos daquele mês, seguindo a referência e a decisão sobre parciais.
- Vendedores com dados pendentes não recebem posição de lucro fictícia. A ação para corrigir a pendência abre a tela Custos no vendedor e mês corretos.
- Valores sem vendedor e despesas gerais não disputam posição no ranking.

### Dashboard financeiro

- Resumo de receita agendada, recebida, custos, lucro confirmado e margem.
- Composição de custos e comparação entre custo acumulado e pagamentos confirmados.
- Conciliação: resultados dos vendedores + resultado não atribuído - despesas gerais não rateadas = resultado consolidado. O imposto já rateado não é descontado novamente. Impostos sem pedidos pagos permanecem no consolidado como custo não alocado.
- A apresentação não inclui leads, métricas operacionais ou cenários de taxas presumidas.

## Abordagem técnica proposta

Uma consulta financeira compartilhada calcula os resultados no Postgres, a partir de pedidos, anúncios, remuneração e lançamentos. As três telas consomem essa mesma base. Separar fórmulas no frontend ou copiar as consultas divergentes da referência criaria diferenças de lucro entre telas.

O worker preserva os dados financeiros recebidos, a plataforma e a versão temporal da atualização. O backfill usa o último evento financeiro válido de cada pedido e diferencia ausência, nulo e zero. Eventos logísticos incompletos ou mais antigos não podem apagar ou fazer regredir dados de pagamento.

As tabelas e RPCs continuam restritas aos usuários autenticados, como já autorizado. O fluxo de caixa existente não entra automaticamente no cálculo para evitar a duplicação de despesas.

## Decisões confirmadas para o plano

- Incluir recebimentos parciais efetivos, preservando a competência do agendamento.
- Mostrar custos conhecidos e indicar taxa/lucro pendentes quando a taxa histórica não puder ser recuperada. O usuário não autorizou estimativas.
- A referência remota foi conferida com a credencial disponibilizada pelo usuário; as regras de ranking e dashboard correspondem às versões locais analisadas.
- Adotar a regra de devoluções solicitada por equivalência com a referência: recuperar fabricação apenas no estado final Devolvido e manter o frete. Em Devolução continua gerando custo de fabricação. Usar estados financeiros versionados para cancelamento/rastreio, com fallback comercial somente quando o fato correspondente estiver ausente, sem confundir estados de taxa de cancelamento.
