# Custos, ranking e dashboard financeiro

## Intenção e decisões

Substituir a página financeira única por três telas claras, seguindo a referência Wellington/Afiliados: Custos, Ranking de vendedores e Dashboard financeiro. Usar a mesma base de cálculo para explicar quanto cada vendedor custou desde os agendamentos, quanto já foi recebido e quando atingiu o ponto de equilíbrio.

As respostas do usuário de 11/11/2026 autorizam recebimentos parciais efetivos e determinam que taxas ausentes permaneçam pendentes, sem estimativas. Salário continua manual por vendedor e mês; comissão percentual continua vigente por vendedor até uma alteração, com preservação histórica. Todos os usuários autenticados podem consultar e editar o financeiro.

A comparação com código e banco de referência está em `2026-11-11-financial-workspace-research.md`. A adaptação preserva os valores acordados do Interna e inclui Skale e adquirência também no ranking. Custos gerais ficam separados para reconciliar o consolidado sem rateios inventados.

## Competência e reconhecimento

- Usar mês civil em America/Sao_Paulo, definido pela criação do pedido em `orders.data`. Pagamentos tardios atualizam o mês do pedido. Preservar o mês ao navegar entre as três telas.
- Normalizar os estados Pago e as variantes Parcial, Pago Parcial e pago_parcial. Outros estados não reconhecem receita. Uma data de pagamento sem estado reconhecido não é suficiente.
- O estado financeiro versionado do retrato é autoritativo. Usar `orders.status_pagamento` somente quando o retrato não contiver estado, pois notificações comerciais antigas não têm proteção temporal equivalente.
- Para Pago, usar `transaction.paid_amount / 100` quando explícito e válido; na ausência, usar `transaction.total_price / 100` de um evento que confirme Pago, como na referência. Não substituir pelo preço agendado.
- Um evento posterior com apenas o preço de fallback não pode substituir um `paid_amount` explícito já conhecido para o mesmo estado de pagamento.
- Para parcial, usar somente `paid_amount / 100` explícito e válido. Ausência significa receita pendente; não substituir pelo preço integral nem presumir zero. Não somar retratos de recebimento repetidos na fila.
- Receita conhecida é o subtotal efetivamente recuperado. Receita confirmada total e lucro ficam indisponíveis se houver recebimento parcial sem valor recuperável.
- Faturamento agendado bruto inclui os pedidos do mês. A comissão interna continua incidindo sobre o faturamento agendado válido, excluindo cancelados, conforme a configuração anterior do Interna.

## Custos diretos

- Salário do vendedor: valor lançado para aquele mês exato, sem repetição automática. Vendedor sem movimento só entra pelo salário manual. Ausência de salário em vendedor com atividade gera pendência; R$ 0 explícito é válido.
- Comissão interna: percentual vigente multiplicado pelo agendado não cancelado; arredondar em centavos. Não confundir com comissão externa do payload.
- Fabricação: R$ 6,90 por unidade de pedido não cancelado e não devolvido. Devolvido recupera fabricação; Em Devolução mantém o custo. Quantidade ausente em pedido elegível gera pendência.
- Frete: R$ 30 por pedido não cancelado, inclusive devolvido e ainda não pago.
- Cancelado no financeiro: estado de pagamento versionado Cancelado ou rastreio versionado exatamente Cancelado, ignorando caixa e espaços. Usar `orders.cancelado` somente sem estado de pagamento financeiro; usar rastreio comercial somente sem rastreio financeiro. O flag comercial é derivado de notificações sem proteção temporal e não pode contrariar um estado financeiro mais novo. Estados Taxa de Cancelamento e Taxa de Cancelamento Pago não são cancelamento por substring. Essa classificação não altera as métricas comerciais existentes.
- Tráfego: investimento BRL do vendedor no mesmo mês, mantendo as exclusões da conta 1392600858079467 e campanha 52598941009722. Somar o tráfego do vendedor/mês e arredondar para centavos antes de compor o custo; o consolidado soma essas parcelas, preservando a reconciliação apesar da precisão extra da conversão cambial.
- Skale: R$ 0,50 por pedido criado, inclusive cancelado, uma vez por pedido.
- Adquirência: `transaction.acquirer_cost / 100`, válido e não negativo. Ausência ou JSON null não significam zero. Não usar `total_price - producer_earned - affiliate_earned` no Interna porque esses ganhos normalmente vêm zerados. A taxa conhecida permanece como custo após chargeback, até uma atualização explícita; não inventar devolução da taxa.
- Um pagamento confirmado ou parcial sem adquirência recuperável gera pendência de taxa, qualquer que seja a plataforma. Estados de chargeback/estorno com pagamento anterior também não comprovam taxa zero. Eventos nunca pagos e sem taxa conhecida não têm custo de pagamento presumido.
- Comissão externa: valor explícito de `transaction.affiliate_earned / 100`, separado da comissão interna e reconhecido nos estados Pago/Parcial. Zero explícito é válido; ausência em pagamento reconhecido gera pendência. Essa parcela já existe em um pedido real do Interna.

## Impostos e despesas gerais

- Imposto efetivamente pago: um registro por mês, valor não negativo, inclusive zero explícito. Ausência de lançamento significa nenhum imposto registrado, como na referência, com estado visual Não lançado.
- Ratear o imposto do mês de agendamento pela quantidade de pedidos Pago/Parcial de cada vendedor e da linha não atribuída. Arredondar por piso e distribuir os centavos restantes por maior resto, com desempate estável por identificador.
- Sem pedidos pagos, manter o imposto como custo geral não alocado no dashboard. Não desaparecer com essa despesa e não descontar novamente a parcela já rateada.
- Outras despesas gerais: descrição de 1 a 200 caracteres, valor positivo com duas casas e data. Criar, editar e excluir na tela Custos. Esses valores afetam apenas o consolidado, sem distribuição artificial entre vendedores.
- Não importar automaticamente `cash_flow_entries`; isso duplicaria custos sem vínculo confiável. Não lançar novamente os salários de vendedores como despesas gerais.

## Resultado e pendências

- Custo conhecido é a soma das parcelas conhecidas, claramente identificada como subtotal quando existir pendência.
- Fabricação, adquirência e comissão externa retornam seus subtotais conhecidos mesmo quando outro pedido da linha está incompleto. Por exemplo, cinco unidades conhecidas continuam contribuindo R$ 34,50 quando outro pedido está sem quantidade. As contagens de pendência impedem tratar esse subtotal como custo completo.
- Custo total = salário + comissão interna + fabricação + frete + tráfego + Skale + adquirência + comissão externa + imposto rateado. Fica indisponível quando qualquer parcela necessária está pendente.
- Lucro confirmado = receita confirmada - custo total. Margem = lucro / receita confirmada; sem receita, a margem é indisponível e o prejuízo em reais continua válido se os custos estiverem completos.
- Falta para equilíbrio = max(custo total - receita confirmada, 0); excedente = max(receita confirmada - custo total, 0). Não calcular breakeven ou posição de lucro quando houver pendência.
- Consolidado = soma dos resultados de vendedores e não atribuídos, menos despesas gerais e imposto não alocado. Mostrar os custos conhecidos mesmo quando o lucro total não puder ser fechado.
- Exibir contagens e motivos exatos de pendência: salário, comissão interna, unidades, adquirência, recebimento ou comissão externa. Taxa ausente no histórico deve ser descrita como pendência de origem, sem direcionar o usuário a um formulário que não possa corrigi-la.

## Dados e processamento

Adicionar uma tabela de retrato financeiro por pedido, sem criar um razão por evento. Campos monetários nullable, plataforma, estado de pagamento, rastreio financeiro, origem do valor recebido, instante de origem e identificador da mensagem permitem preservar ausência, zero e versões. A classificação de cancelamento/devolução usa o rastreio versionado, recorrendo ao campo comercial apenas quando não houver rastreio financeiro; um evento logístico antigo não pode restaurar fabricação ou frete indevidamente.

O parser compartilhável do worker valida centavos inteiros e datas de origem, normaliza estados e seleciona somente valores explícitos e coerentes. O worker persiste o retrato depois de criar/atualizar o pedido e antes de arquivar a mensagem. Duplicatas devem continuar permitindo a atualização idempotente do retrato.

Atualizações mais novas substituem valores presentes; campos ausentes não apagam valores conhecidos. Mensagens antigas não fazem regredir estado, recebimento ou taxas. Uma taxa válida antiga pode preencher uma lacuna, preservando o estado mais recente; recebimento antigo só pode completar uma lacuna do mesmo estado financeiro. Usar timestamp de origem e msg_id para desempatar.

Backfill a partir de `pgmq.a_orders_ingest`, unido aos pedidos existentes e sem consumir/reprocessar a fila. Usar o último valor financeiro válido e preservar os eventos de origem. Exclusão de mensagens de teste deve seguir o worker. A data de agendamento e as unidades existentes não são regravadas.

Após publicar o novo worker e confirmar que uma execução anterior terminou pelo lease, executar reconciliação integral idempotente do arquivo. Não limitar esse passo ao maior msg_id anterior: uma mensagem antiga em retry pode ser arquivada durante o deploy com ID menor que esse marco. Conferir a cobertura depois da reconciliação, sem duplicar custos ou receitas.

## Consulta compartilhada

Criar `get_financial_workspace(p_month date) returns jsonb`, autenticada, validando o primeiro dia do mês. A RPC atual `get_financial_dre(date)` pode continuar existindo para compatibilidade durante a entrega; as três novas telas usam somente a nova consulta.

Contrato de resposta:

- `month`: YYYY-MM-01.
- `summary`: mesmos campos financeiros das linhas, acrescidos de `general_expenses`, `unallocated_tax` e `tax_recorded`.
- `rows`: vendedor ou não atribuído; cada linha contém `row_type`, `seller_id`, `seller_name`, `order_count`, `product_units`, `scheduled_revenue`, `commission_base_revenue`, `known_received_revenue`, `confirmed_revenue`, `salary_cost`, `commission_pct`, `commission_cost`, `production_cost`, `shipping_cost`, `traffic_cost`, `skale_cost`, `payment_fee_cost`, `external_commission_cost`, `allocated_tax`, `known_cost`, `total_cost`, `confirmed_profit`, `margin_pct`, `remaining_to_break_even`, `surplus` e `pending`.
- `pending`: objeto de contagens para `salary`, `commission`, `units`, `payment_fee`, `received_amount` e `external_commission`. Zero significa sem pendência.
- `seller_settings`: lista de vendedores ativos ou presentes no mês, com `seller_id`, `seller_name`, `monthly_salary`, `commission_pct`, `commission_effective_month` e `month_commission_pct` (percentual exatamente no mês, nullable), para preservar mudanças históricas no formulário.
- `expenses`: registros gerais do mês, com `id`, `description`, `amount` e `cost_date`.
- `tax`: `{month_start, tax_paid}` ou null. `rates`: `{production: 6.90, shipping: 30.00, skale: 0.50}`.

Todos os valores monetários são BRL; nunca enviar o corpo completo dos pedidos para essas telas. As tabelas de remuneração/impostos/despesas usam RLS e grants somente para autenticados. Retratos por pedido e sua função de gravação são restritos ao service_role. A RPC agrega as tabelas privadas, fixa search_path e revoga acesso de public/anon.

## Telas

### Custos

Mês visível no topo, regras automáticas em uma faixa compacta, lista de vendedores com salário do mês, comissão vigente e estado de configuração. Editar por linha abre um único formulário com vendedor e competência explícitos; um salvamento preserva campos não alterados e a vigência das comissões.

Uma área separada contém imposto do mês e extrato de despesas gerais, com ação Adicionar despesa. Exclusão de lançamento pede confirmação concreta. Retornar ao ranking mantém o mês e o contexto do vendedor.

### Ranking

Lucro confirmado decrescente, desempate por nome. Vendedores completos recebem posição; pendentes aparecem em bloco próprio sem pódio fictício. Não atribuídos ficam fora da competição.

Cada vendedor mostra receita agendada, recebida, custo, lucro e margem. A barra de custo e a barra de receita usam a mesma escala, com percentual coberto e os estados Faltam R$ X, No ponto de equilíbrio ou Se pagou com excedente. Não depender apenas de cor ou animação. Detalhar parcelas sem transformar a tabela em uma largura impossível no celular.

### Dashboard financeiro

Cartões para receita agendada, recebida, custos conhecidos, lucro e margem; chamar o custo de Total somente quando estiver completo. Composição financeira por parcela, comparação visual de receita e custo e reconciliação de vendedores, não atribuídos, imposto não alocado e despesas gerais. Mostrar motivo de números pendentes e atalho apropriado para Custos.

Não portar leads, entregas, colunas operacionais, cenários de taxas presumidas ou simuladores. Usar React/CSS e dependências já presentes. Manter carregamento, erros, foco de teclado, layout móvel e atualização automática sem desmontar um formulário em edição.

## Abordagens e execução

A estrutura de três telas foi solicitada pelo usuário. A abordagem adotada mantém cálculo mensal no Postgres e um retrato atual por pedido, reaproveitando a escolha anterior de consulta dinâmica. Copiar consultas independentes do Wellington preservaria divergências de total; criar um razão completo por evento excederia a necessidade.

Executar em worktree isolado, com testes de integração Postgres para cálculos, permissões, rateio e histórico e testes de parser para os payloads. Conferir interface em desktop e celular com dados simulados. Aplicar no Interna somente as migrações revisadas e publicar o worker após os testes; não alterar Wellington. Preservar os arquivos locais de Wyllian não rastreados.
