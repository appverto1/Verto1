# Construtor modular de propostas e rentabilidade

Versão técnica: `20260727030000`

## Escopo e arquitetura

Esta evolução reutiliza o fluxo comercial existente:

- `sales_leads` continua sendo a origem do lead;
- `sales_financial_assumption_sets` continua versionando premissas;
- `sales_offer_simulations` continua armazenando os cenários;
- `sales_offers` continua armazenando propostas e tokens públicos;
- o motor legado por paciente e seu Checkout Stripe permanecem intactos;
- o modo modular é identificado por `simulation_type = 'modular'` e
  `offer_type = 'modular'`;
- simulações e propostas não escrevem em tabelas de DRE realizada.

O frontend calcula a prévia com a mesma biblioteca TypeScript usada pelo
backend. Ao salvar, o backend ignora totais enviados pelo navegador, recarrega
catálogo e premissas, recalcula e persiste o snapshot com uma RPC transacional.

## Auditoria do fluxo existente preservado

1. `SalesProfitabilitySimulator` recebe `lead`, `onClose`,
   `onOpenAssumptions` e `onOfferPrepared`; o mesmo ponto de entrada agora
   hospeda o construtor modular e mantém o simulador legado como fallback
   compatível quando a migration ainda não existe.
2. `salesProfitability.ts` calcula receita por paciente, desconto em basis
   points, inadimplência, Stripe, imposto, custos variáveis, operação, rateio
   fixo, contribuição, EBITDA, despesas abaixo do EBITDA, imposto sobre lucro,
   lucro gerencial, projeções e ponto de equilíbrio. O arquivo não foi
   substituído.
3. `GET/POST /api/owner/sales/profitability-assumptions` continua listando e
   criando versões de premissas; as rotas permanecem protegidas por sessão
   owner/Super Admin e MFA.
4. `GET/POST /api/owner/sales/leads/:leadId/simulations` continua listando e
   salvando simulações legadas. O histórico permanece limitado, associado ao
   lead e protegido contra uma chave idempotente reutilizada com outro payload.
5. `POST /api/owner/sales/leads/:leadId/simulations/:simulationId/select`
   continua marcando o cenário escolhido, registrando data e evento auditável
   sem recalcular o snapshot.
6. A preparação legada continua lendo a simulação selecionada, validando
   `lead_id`, custo e justificativa, e criando `sales_offers` pelo fluxo
   existente; a preparação modular usa uma ramificação própria antes da
   Stripe.
7. `PublicSalesOffer` continua carregando a oferta pelo token público,
   apresentando preço, desconto, duração, validade e Checkout apenas para a
   proposta legada. A nova apresentação modular usa somente campos
   comerciais.
8. No legado, a oferta copia quantidade, preço-base, desconto, duração,
   valores promocional e pós-promoção, premissas/resultados da simulação,
   justificativa, validade e referências de auditoria. No modular, esses
   campos continuam compatíveis e ganham catálogo, resumo e linhas congeladas.
9. `assumptions_snapshot` e `results_snapshot` continuam preservando a versão
   histórica; o modular acrescenta `modular_input_snapshot`,
   `sales_offer_simulation_items`, `modular_snapshot` e
   `sales_offer_items`, protegidos contra mutação financeira.
10. A classificação existente prioriza margem EBITDA, usa contribuição quando
    EBITDA está indisponível e compara com os limites `healthy` e `attention`;
    custo incompleto produz `insufficient_data`, nunca zero implícito.
11. O rateio fixo legado permanece `none`, `custom`, `per_patient` ou
    `per_clinic`, com denominadores das premissas. O modular acrescenta
    alocação determinística por receita, peso ou pacote-base sem alterar a
    fórmula anterior.
12. Stripe legado é percentual sobre a receita mais tarifa fixa; imposto e
    inadimplência usam basis points; custos variáveis e suporte separam
    parcelas por paciente e por clínica; operação e fixos entram no EBITDA; e
    depreciação, despesas financeiras, demais despesas e imposto sobre lucro
    ficam abaixo do EBITDA. A versão modular reutiliza essas premissas e apenas
    distribui cada componente entre as funcionalidades.

## Catálogo inicial

| Chave | Modelo | Configuração inicial |
|---|---|---|
| `clinical_core` | `package_limit` | até 10: R$ 199; até 25: R$ 399; até 50: R$ 699; até 100: R$ 1.199; acima: personalizado |
| `appointments_communication` | `package_limit` | R$ 49 / R$ 79 / R$ 129 / R$ 199 / personalizado |
| `financial_management` | `flat_monthly` | R$ 99 por clínica/mês |
| `insurance_tiss` | `usage_tier` | até 100: R$ 149; até 500: R$ 299; acima: personalizado |
| `school_management` | `package_limit` | R$ 59 / R$ 99 / R$ 149 / R$ 249 / personalizado |
| `additional_storage` | `storage_block` | 1 GB: R$ 2,99; 5 GB: R$ 9,90; 10 GB: R$ 16,90 |
| `onboarding` | `one_time` | gratuito, padrão das premissas ou personalizado |

O pacote `clinical_core` inclui toda a estrutura clínica e ABA e 100 MB de
arquivos por paciente permitido na faixa. Os preços ficam somente no catálogo
do banco, não são duplicados em constantes comerciais do frontend.

Os custos iniciais são gravados como `unavailable`, com valores nulos. Isso é
intencional: nenhuma hipótese de custo é inventada ou tratada como zero. O owner
deve criar um rascunho, informar fontes e custos e publicar uma nova versão.

## Fórmulas

Todos os valores monetários são inteiros em centavos e descontos são inteiros em
basis points.

Para cada item recorrente:

```text
desconto_item = round(receita_bruta_item × desconto_item_bps / 10.000)
base_global_item = receita_bruta_item - desconto_item
desconto_global_total = round(soma(base_global_item) × desconto_global_bps / 10.000)
receita_promocional_item = base_global_item - parcela_desconto_global_item
receita_pos_promocao_item = base_global_item
```

O desconto global é distribuído proporcionalmente à receita após o desconto do
item. Qualquer resíduo de centavos vai deterministicamente para
`clinical_core`.

```text
contribuicao_item =
  receita_liquida_item
  - custo_direto_item
  - taxas_transacao_tributos_inadimplencia_alocados_item

ebitda_item =
  contribuicao_item
  - custo_plataforma_compartilhado_alocado_item

lucro_gerencial_item =
  ebitda_item
  - despesas_abaixo_ebitda_alocadas_item
  - imposto_sobre_lucro_alocado_item
```

Margens usam `round(resultado × 10.000 / receita)`. Se a receita for zero, a
margem é `null`. Se um custo obrigatório estiver indisponível, os resultados
dependentes são `null` e a classificação é `insufficient_data`.

Custos de implantação são contabilizados uma vez na projeção de 12, 24 e 36
meses. Quando parcelados comercialmente em até 36 vezes, apenas a receita das
parcelas contidas no horizonte é reconhecida; o custo de implantação ocorre uma
única vez. O parcelamento não cria cobrança nem altera a Stripe.

## Critérios de alocação

O catálogo guarda explicitamente os critérios, que podem ser alterados somente
em nova versão:

- tarifa percentual Stripe: receita líquida;
- tarifa fixa Stripe: pacote-base;
- imposto sobre faturamento: receita líquida;
- inadimplência: receita líquida;
- custos compartilhados de plataforma: peso configurado por funcionalidade;
- despesas abaixo do EBITDA: peso configurado por funcionalidade.

Cada componente é rateado separadamente. Em todos os rateios, o resíduo inteiro
de centavos fica no pacote-base. Assim, a soma das linhas coincide exatamente
com receita, descontos, custos, contribuição, EBITDA e lucro consolidados.

## Persistência e imutabilidade

- catálogo publicado ou arquivado: itens, faixas e custos não podem ser
  alterados;
- cenário modular: campos financeiros e snapshots não podem ser alterados;
- nome, seleção e arquivamento do cenário continuam editáveis;
- linhas de cenário e proposta são imutáveis;
- a proposta copia as linhas e o snapshot do cenário em uma única transação;
- retries com a mesma chave e o mesmo hash recuperam a mesma entidade;
- a mesma chave com payload diferente gera `PROPOSAL_SNAPSHOT_CONFLICT`;
- falha em qualquer linha reverte cenário ou proposta por inteiro.

O construtor compara até três cenários com composição e limites, total,
desconto, custo, EBITDA, margem, lucro e diferença para o cenário-base. A
prévia pública reutiliza o mesmo componente comercial da página aberta pelo
token; dados internos não entram nas propriedades desse componente.

## Segurança

Catálogo, custos, linhas, relatório e RPCs não têm acesso para `public`, `anon`
ou `authenticated`. Somente `service_role` possui acesso. As rotas exigem
sessão owner/Super Admin e MFA validado pelo middleware `checkOwner`.

O backend valida o `lead_id` em cada leitura e mutação, recarrega os IDs de
catálogo e premissas e não aceita preço, custo, margem, EBITDA, lucro ou
classificação calculados pelo cliente.

A resposta pública seleciona apenas nome, descrição, limites, quantidades,
preços, desconto, duração, implantação e observação pública. Custos, premissas,
pesos, justificativa, margem, EBITDA e lucro nunca são selecionados.

## Stripe e cobrança

Gerar uma proposta modular:

- não chama Stripe;
- não cria cupom;
- não cria Checkout;
- não cria assinatura;
- deixa `modular_checkout_enabled = false`;
- mantém todos os IDs Stripe nulos.

O endpoint público de Checkout retorna
`PROPOSAL_MODULAR_CHECKOUT_NOT_ENABLED` antes de resolver configuração ou criar
um cliente Stripe. Propostas legadas continuam no fluxo anterior.

## Performance

- catálogo: uma consulta de versão e três consultas em lote para itens, faixas e
  custos;
- cenários: lead e página de cenários em paralelo; linhas e ofertas em duas
  consultas em lote;
- nenhum fetch ou query por item;
- prévia local reutiliza dados já carregados;
- recálculo no backend ocorre somente ao salvar;
- após salvar, selecionar, renomear, arquivar ou gerar proposta, a UI atualiza o
  estado local;
- histórico é limitado e paginado;
- relatório é uma view agregada, não uma consulta por card.

## Aplicação manual

1. Abra o SQL Editor do Supabase no projeto correto.
2. Execute
   `supabase/migrations/20260727030000_sales_modular_proposal_builder.sql`.
3. Execute
   `supabase/tests/20260727030000_sales_modular_proposal_builder_test.sql`.
   O arquivo termina com `rollback` e não preserva fixtures.
4. Execute as consultas de
   `supabase/verification/20260727030000_sales_modular_proposal_builder_checks.sql`.
5. Publique o código somente depois da migration.

## Rollback seguro

A migration não remove ou reescreve dados existentes. Se a aplicação ainda não
estiver em produção, o rollback preferido é não publicar o código e reverter a
transação da migration em caso de erro.

Depois de aplicada com sucesso, não remova estruturas que já possuam cenários ou
propostas. Para desativação operacional segura:

1. mantenha as tabelas e snapshots;
2. retire o acesso ao construtor modular no código;
3. mantenha o fluxo legado;
4. arquive o catálogo ativo apenas por migration de rollback revisada;
5. não apague `sales_offer_simulations`, `sales_offers`,
   `sales_offer_simulation_items` ou `sales_offer_items`.

Uma remoção física futura exige migration nova, verificação de ausência de
dependências e autorização explícita. Esta entrega não contém exclusão
automática.
