# Manifesto — aprovação comercial excepcional

Data: 28/07/2026

## Escopo

Esta entrega preserva o motor comercial já implementado e corrige somente:

- separação entre bloqueios técnicos e alertas comerciais excepcionáveis;
- aprovação individual de condição comercial por owner com MFA;
- congelamento e revalidação server-side da aprovação;
- bloqueio explícito quando a migration de `profitability_policy` estiver pendente;
- terminologia comercial visível de margem e resultado operacional atribuído;
- testes de regressão desses contratos.

Nenhuma política global é alterada por uma aprovação individual. Nenhum total,
margem ou `economics.canSend` enviado pelo navegador é aceito como autoridade.

## Arquivos do pacote

- `package.json`
- `server.ts`
- `src/components/PublicSalesOffer.tsx`
- `src/components/SalesFinancialAssumptionsPanel.tsx`
- `src/components/SalesModularProposalBuilder.tsx`
- `src/components/SalesPricingCatalogPanel.tsx`
- `src/components/SalesProfitabilitySimulator.tsx`
- `src/utils/salesCommercialEvolution.ts`
- `src/utils/salesModularCostDrivers.ts`
- `src/utils/salesModularEconomics.ts`
- `src/utils/salesModularProposal.ts`
- `supabase/migrations/20260728020000_sales_modular_profitability_policy.sql`
- `supabase/post_migration/20260728020000_sales_modular_profitability_policy_checks.sql`
- `supabase/tests/20260728020000_sales_modular_profitability_policy_test.sql`
- `tests/fixtures/salesModularFixture.ts`
- `tests/salesCapacityPolicyVersioning.test.ts`
- `tests/salesCommercialEvolution.test.ts`
- `tests/salesCommercialExceptionApproval.test.ts`
- `tests/salesModularEconomics.test.ts`
- `tests/salesModularProposalFlow.test.ts`
- `tests/salesModularStripeAssisted.test.ts`
- `tests/salesPersonalizedPerPatientPricing.test.ts`
- `tests/salesProfitabilityPolicyVersioning.test.ts`

O ZIP não contém `dist`, dependências, credenciais, arquivos de ambiente nem
entregas anteriores.

## Classificação dos bloqueios

### Técnicos, não excepcionáveis

Dados de custo ou driver ausentes, preço por paciente ausente, denominador
financeiro inválido, catálogo ou premissa inválidos, dependência ou capacidade
inválidas, resultado irreconciliável, divergência de snapshot, adulteração do
payload, falta de autorização e falta de MFA continuam bloqueando o fluxo.

O classificador é fail-closed: um código desconhecido é técnico até existir
classificação comercial explícita.

### Comerciais, excepcionáveis

Margens abaixo das metas, fase promocional deficitária, módulo gratuito com
custo e condição estratégica de cliente-vitrine podem ser aprovados por
proposta. Sem aprovação, o cenário pode ser salvo como rascunho, mas não gera
proposta pública. Com aprovação válida, os cálculos permanecem inalterados.

## Snapshot interno da aprovação

O snapshot congela:

- versão do contrato e status;
- tipo da exceção;
- confirmação explícita;
- códigos aprovados;
- margens promocional e posterior;
- margens dos módulos afetados;
- margem de capacidade;
- preço mensal e preço por paciente;
- capacidade contratada;
- usuário aprovador e data/hora;
- versão do catálogo e da política;
- justificativa;
- SHA-256 do resultado aprovado.

Qualquer mudança de preço, composição, capacidade, drivers ou resultado altera
o hash. Uma aprovação antiga deixa de corresponder e não pode ser reutilizada.

## Segurança e persistência

- owner e MFA são revalidados no backend;
- o servidor recalcula o resultado antes de aprovar ou publicar;
- o DTO público usa lista permitida e não expõe aprovação, justificativa,
  custos ou margens;
- o snapshot interno preserva a auditoria sem recalcular propostas históricas;
- nenhuma query, cache ou fallback mistura tenants;
- nenhuma chave Stripe ou dado clínico foi movido para o frontend;
- Checkout e Stripe continuam consumindo somente valores congelados.

## Pré-requisitos de banco

1. Aplicar manualmente
   `20260728010000_sales_multidisciplinary_commercial_evolution.sql`.
2. Aplicar manualmente, antes do deploy desta versão,
   `20260728020000_sales_modular_profitability_policy.sql`.
3. Executar manualmente
   `supabase/post_migration/20260728020000_sales_modular_profitability_policy_checks.sql`.
4. Executar o teste SQL em ambiente descartável/controlado quando aplicável.

Nenhum SQL foi executado por esta entrega. A ausência física da coluna
`profitability_policy` retorna HTTP 503 com código comercial de migration
pendente e mensagem sanitizada. Um catálogo histórico com a coluna presente e
valor `null` continua compatível.

## Alterações deliberadamente não realizadas

- nenhuma branch, commit, push ou deploy;
- nenhuma alteração no Railway;
- nenhuma chamada Stripe real;
- nenhuma alteração em pagamentos ou assinaturas existentes;
- nenhuma mudança nas fórmulas comerciais;
- nenhuma alteração no arquivo ABA com erro de tipos preexistente;
- nenhuma renomeação de colunas ou contratos legados.

