# Manifesto — margem EBITDA modular

Entrega: 28/07/2026

## Escopo

- Política econômica versionada no catálogo, sem backfill em versões publicadas.
- Motor v5 apenas para catálogos ativos com política válida; catálogo v3 e snapshots anteriores permanecem no motor v4.
- Custos compartilhados e taxa fixa alocados uma única vez ao `clinical_core`.
- Preços mínimos para margens de 60%, 70%, 75% e 80%, usando o perfil intensivo.
- Margem EBITDA do core, margem incremental dos módulos, margem consolidada e margem por fase.
- Bloqueio de envio abaixo de 60%, de condição posterior abaixo de 70%, de módulos posteriores abaixo de 75% e de capacidade/excedentes abaixo de 75%.
- Desconto temporário e justificativa obrigatórios nas condições de atenção.
- Franquias e blocos de excedente versionados por driver, sem valores fictícios.
- Painel “Economia da clínica” e simulador sob demanda para 150, 160, 170 e 200 pacientes, perfis leve, padrão e intensivo e todas as combinações dos quatro módulos.
- Snapshot congela política, margens e premissas; Checkout usa apenas valores congelados.

## Arquivos alterados

1. `package.json`
2. `server.ts`
3. `src/components/SalesModularProposalBuilder.tsx`
4. `src/components/SalesPricingCatalogPanel.tsx`
5. `src/utils/salesModularCostDrivers.ts`
6. `src/utils/salesModularEconomics.ts`
7. `src/utils/salesModularProposal.ts`
8. `supabase/migrations/20260728020000_sales_modular_profitability_policy.sql`
9. `supabase/post_migration/20260728020000_sales_modular_profitability_policy_checks.sql`
10. `supabase/tests/20260728020000_sales_modular_profitability_policy_test.sql`
11. `tests/fixtures/salesModularFixture.ts`
12. `tests/salesCapacityPolicyVersioning.test.ts`
13. `tests/salesCommercialEvolution.test.ts`
14. `tests/salesModularEconomics.test.ts`
15. `tests/salesProfitabilityPolicyVersioning.test.ts`

## Persistência e compatibilidade

- A migration é aditiva, idempotente e mantém `profitability_policy` nullable.
- Não há `UPDATE` de catálogo publicado.
- A política padrão é aplicada somente ao novo draft clonado.
- A publicação injeta `profitabilityPolicy` no `catalog_snapshot`.
- Propostas e cenários anteriores não são recalculados.
- Checkout legado, Stripe, descontos, catálogo v3 e históricos não tiveram contratos substituídos.
- Nenhum SQL foi executado em Supabase real.

## Segurança e performance

- RPCs continuam restritas a `service_role`; owner e MFA permanecem validados no backend.
- Valores de margem e Checkout são reconstruídos ou lidos de snapshot confiável, nunca do navegador como autoridade.
- Nenhum dado clínico novo é enviado à Stripe.
- Catálogo continua carregado em lote: uma leitura de versão e três consultas paralelas de itens, faixas e custos; não há consulta por item.
- O simulador econômico é local, memoizado e só calcula combinações quando aberto.
- Não foi adicionado polling, refetch agressivo ou N+1.

## Itens não executados

- Migration e teste SQL transacional não foram executados, em conformidade com a proibição de SQL real. Os contratos SQL foram cobertos por teste estrutural automatizado.
- Commit, push, deploy, branch e alterações de variáveis Railway não foram realizados.
