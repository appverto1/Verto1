# Manifesto da entrega

ZIP: `verto_evolucao_comercial_cobranca_clinica_20260728.zip`

O ZIP contém somente os arquivos de implementação alterados listados abaixo. Não contém `node_modules`, `dist`, `.env`, logs, credenciais, relatórios de build ou arquivos `.git`.

## Aplicação

- `package.json`
- `server.ts`
- `src/components/AbaClinicalChartsPanel.tsx`
- `src/components/PatientDetailView.tsx`
- `src/components/PatientProfessionalLinksPanel.tsx`
- `src/components/PublicSalesOffer.tsx`
- `src/components/SalesModularProposalBuilder.tsx`
- `src/components/SalesPricingCatalogPanel.tsx`
- `src/components/TherapeuticPlanPanel.tsx`
- `src/components/TherapeuticProgramLibrary.tsx`
- `src/services/dataService.ts`
- `src/utils/abaSpecialtyAnalytics.ts`
- `src/utils/salesCommercialEvolution.ts`
- `src/utils/salesModularCostDrivers.ts`
- `src/utils/salesModularProposal.ts`
- `src/utils/therapeuticTemplatePrivacy.ts`

## SQL manual

- `supabase/migrations/20260728010000_sales_multidisciplinary_commercial_evolution.sql`
- `supabase/tests/20260728010000_sales_multidisciplinary_commercial_evolution_test.sql`
- `supabase/tests/20260728010000_sales_multidisciplinary_commercial_evolution_post_migration.sql`

## Testes

- `tests/clinicalMultidisciplinaryEvolution.test.ts`
- `tests/fixtures/salesModularFixture.ts`
- `tests/salesCapacityPolicyVersioning.test.ts`
- `tests/salesCommercialEvolution.test.ts`
- `tests/salesModularStripeAssisted.test.ts`

Total: 24 arquivos.

Os hashes individuais estão em `SHA256SUMS.txt`.
