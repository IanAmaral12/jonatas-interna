# DRE financeiro por vendedor — desenho

## Intenção

Mostrar ao cliente, por mês de agendamento e por vendedor, quanto a operação já custou, quanto da receita desses pedidos foi confirmado como pago e quanto falta para o vendedor atingir o ponto de equilíbrio. A página contém apenas valores financeiros e os contadores necessários para explicar os custos.

## Escopo e regras

- Seleção por mês civil em `America/Sao_Paulo`, com visão consolidada e uma linha por vendedor. Pedidos pertencem ao mês de `orders.data`, não ao mês em que foram pagos. Um pagamento posterior atualiza a receita confirmada do mês original.
- Considerar pedidos não cancelados. Faturamento agendado é a soma de `orders.valor`. Receita confirmada é a soma de `orders.valor` somente quando `trim(lower(status_pagamento)) = 'pago'`. Pagamento parcial, chargeback e outros status não entram; `data_pagamento` sozinha não confirma pagamento.
- Fabricação: R$ 6,90 por unidade do pedido. Frete: R$ 30,00 por pedido, independentemente da quantidade. Ambos são custos dos agendamentos do mês, mesmo antes do pagamento.
- Tráfego: soma de `meta_campaign_hourly_insights.spend_brl` no mesmo mês, por vendedor associado à campanha. Repetir as exclusões já usadas em `get_cpa_dashboard`: conta `1392600858079467` e campanha `52598941009722`.
- Salário: lançamento manual para cada vendedor e mês, sem repetir automaticamente o mês anterior. Entra no custo mesmo quando não há pedidos nem tráfego naquele mês, desde que tenha sido lançado. Comissão: percentual configurado por vendedor, multiplicado pelo faturamento agendado e arredondado em centavos. Assim, no exemplo dado, R$ 10.000 de faturamento e 8% geram R$ 800 de comissão antes de todos os pedidos serem pagos.
- Custo total = salário + comissão + fabricação + frete + tráfego. Saldo confirmado = receita confirmada − custo total. Falta para o equilíbrio = `max(custo total − receita confirmada, 0)`; excedente = `max(receita confirmada − custo total, 0)`.
- O usuário escolhe o mês de cada salário e o mês inicial de cada percentual de comissão, inclusive meses passados. Salário vale somente para o mês cadastrado. Comissão continua valendo até o início de outro percentual para o mesmo vendedor. Criar uma comissão posterior preserva os meses anteriores; alterar explicitamente um registro antigo recalcula os meses aos quais ele se aplica.
- Qualquer usuário autenticado pode ver o DRE e criar/editar as configurações, como solicitado. Usuários anônimos não podem acessar os dados. Um vendedor com pedidos ou tráfego no mês, mas sem salário lançado ou comissão aplicável, mostra “Configuração pendente”; custo total, saldo e ponto de equilíbrio ficam indisponíveis, sem presumir zero. Um vendedor sem movimento só aparece se tiver salário lançado para o mês. O consolidado sinaliza que está incompleto se qualquer linha exibida tiver custo pendente. Portanto, o cliente deve lançar o salário mesmo nos meses sem movimento para que esse custo entre no consolidado.
- Pedidos e gastos de anúncios sem vendedor associado aparecem como “Não atribuído” no consolidado, com receita, fabricação, frete e tráfego correspondentes; não se inventam salário nem comissão para essa linha.

## Dados e apresentação

- Acrescentar a quantidade total de unidades a `orders`. Popular os pedidos históricos a partir dos payloads arquivados em `pgmq.a_orders_ingest`, preferindo `order_created` e usando outro evento somente quando não existir o de criação. A consulta exploratória encontrou quantidade recuperável para os 3.340 pedidos atuais, inclusive os oito de 26/08/2026. O worker passa a registrar essa quantidade nos novos pedidos. Quantidade ausente ou inválida no futuro deixa o custo de fabricação e o equilíbrio indisponíveis, com aviso explícito.
- Guardar os salários mensais e as alterações de percentual de comissão por vendedor e mês em uma tabela de configurações financeiras. Salário e percentual são campos independentes; um registro pode alterar apenas um deles. Restringir valores a salário não negativo e comissão entre 0% e 100%. A consulta agregada do DRE fica no Postgres, retornando valores monetários em BRL, linhas por vendedor, linha não atribuída e total consolidado.
- Adicionar “DRE financeiro” à navegação existente. A página mostra mês selecionado, faturamento agendado, receita paga, cada componente do custo, custo total e saldo confirmado. Em cada vendedor, a barra superior representa custo total e a inferior, receita paga; ambas usam a mesma escala e exibem valores em reais. Abaixo, mostrar quanto falta ou quanto excedeu o equilíbrio. Recarregar a consulta a cada minuto enquanto a página estiver aberta e após salvar uma configuração.

## Limites desta entrega

- Não misturar `cash_flow_entries` com o DRE: lançamentos manuais não têm vínculo confiável com pedidos e poderiam duplicar custos.
- Não incluir leads, pré-agendamentos, métricas de campanha, impostos, taxas de plataforma ou pagamentos parciais no cálculo solicitado.
- Não criar um razão financeiro por evento, nem instalar dependências novas. O cálculo mensal usa os dados atuais de pedidos, anúncios e configurações com vigência.

## Abordagens consideradas

1. **Cálculo mensal na consulta — escolhida.** Uma função SQL agrega pedidos, anúncios e configuração vigente. Atualizações de status `Pago` aparecem automaticamente no mês do pedido. Menor mudança, consistente com os RPCs atuais.
2. **Lançamentos por evento.** Um histórico próprio de cada custo e pagamento facilitaria auditar estados passados, mas exigiria alterar o processamento de webhooks e reconciliar todos os eventos antigos. Complexidade sem necessidade para o objetivo atual.

## Pontos para o plano

O plano deve separar: migração e recuperação de unidades; gravação de unidades futuras no worker; configurações mensais com RLS; função SQL e testes de fórmula, vigência, pagamentos tardios, exclusões de tráfego e dados incompletos; página financeira e barras acessíveis; verificação final sem alterar os dois arquivos não rastreados já presentes no repositório.
