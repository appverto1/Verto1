# Manifesto — motor modular de custos por drivers v2

Pacote: `Verto_20260727040000_sales_modular_cost_drivers_v2.zip`  
Migration manual: `20260727040000_sales_modular_cost_drivers_v2.sql`  
Modelo: `2026-07-27-v2`

## Conteúdo do ZIP

1. `package.json`
2. `server.ts`
3. `src/components/SalesModularProposalBuilder.tsx`
4. `src/components/SalesPricingCatalogPanel.tsx`
5. `src/utils/salesModularCostDrivers.ts`
6. `src/utils/salesModularProposal.ts`
7. `tests/salesModularProposal.test.ts`
8. `tests/salesModularProposalFlow.test.ts`
9. `supabase/migrations/20260727040000_sales_modular_cost_drivers_v2.sql`
10. `supabase/tests/20260727040000_sales_modular_cost_drivers_v2_test.sql`
11. `supabase/verification/20260727040000_sales_modular_cost_drivers_v2_checks.sql`
12. `docs/20260727040000_sales_modular_cost_drivers_v2.md`

O ZIP não contém `dist`, `node_modules`, credenciais, logs, migrations antigas,
arquivos sem alteração, commit, branch ou artefatos de deploy.

## Estado preservado

- A migration `20260727030000_sales_modular_proposal_builder.sql` não foi
  editada e não está no ZIP.
- Nenhum catálogo foi apagado, recriado, publicado ou arquivado.
- Nenhum SQL foi executado no Supabase real.
- Nenhum snapshot histórico ou registro de DRE foi recalculado.
- Checkout modular permanece desabilitado; fluxo e Checkout legados permanecem
  no contrato anterior.
- Nenhum commit, push, deploy ou branch foi criado.

## Contratos corrigidos antes da migration

- `supportPatientCost = item_direct` exige custo por paciente explícito em
  Verto Clínica, Agenda e Comunicação e Gestão Escolar; zero é válido e `null`
  bloqueia a publicação.
- `otherVariableCost` possui coluna, constraint, tipos, persistência, clone,
  snapshot, cálculo, detalhamento, duplicidade e validação próprios.
- Ownership possui exatamente 11 propriedades. `requiredDrivers` é validado
  como conjunto, sem depender da ordem e sem aceitar ausências, extras ou
  duplicações.
- A matriz de aplicabilidade é canônica em TypeScript e espelhada pela função
  SQL testada transacionalmente.
- O teste SQL cria um clone temporário pelas RPCs v2, salva, testa retry e
  conflito, exerce todos os bloqueios e publica dentro de `BEGIN`/`ROLLBACK`.

## Validação resumida

- `npm ci`: concluído; 423 pacotes, com aviso de engine Node 20 versus ambiente
  Node 22 e auditoria existente de 16 vulnerabilidades.
- `npm run build`: aprovado (3.124 módulos).
- Motor modular: 46/46.
- Fluxo modular: 17/17.
- Simulador/fluxo legado: 16/16 e 14/14.
- Comercial: 19/19 (assistido), 12/12 (schema) e 6/6 (entrada financeira).
- Checkout legado: 7/7; billing: 28/28; MFA: 11/11; segurança: 26/26.
- Docker runtime imports: 57 arquivos cobertos.
- `git diff --check`: aprovado.
- `npm run lint` e `npm run typecheck`: ambos param no mesmo erro preexistente
  em `src/server/abaRecommendationIdentity.ts:54`, arquivo não alterado.
- O SQL transacional não foi executado em banco nesta tarefa, em cumprimento à
  proibição de executar SQL real; o fluxo TypeScript valida estaticamente que
  o arquivo exerce clone/save/publish v2, conflito, rollback e imutabilidade.

Os hashes dos arquivos e do ZIP estão em
`Verto_20260727040000_sales_modular_cost_drivers_v2_SHA256SUMS.txt`.
