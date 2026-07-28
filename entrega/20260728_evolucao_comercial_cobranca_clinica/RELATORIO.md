Tarefa corrigida: política de capacidade versionada sem mutar catálogos publicados.

## 1. O que foi corrigido

- A mesma migration `20260728010000_sales_multidisciplinary_commercial_evolution.sql` foi corrigida antes da aplicação.
- Removidos o `UPDATE` de backfill, o `DEFAULT` de coluna e o `NOT NULL` global de `custom_capacity_policy`.
- A coluna permanece nullable e a constraint aceita somente `null` ou uma política integralmente válida.
- v1 arquivada e v2 ativa permanecem com `custom_capacity_policy = null`.
- O clone v2 cria somente um novo draft, preserva política existente ou aplica a política padrão exclusivamente ao target.
- O clone continua preservando `modular_cost_settings`, `driver_config` e `other_variable_cost_cents`.
- Retry do clone retorna o mesmo draft; mesma chave com nome/origem divergente gera conflito.
- A RPC de salvamento aceita `customCapacityPolicy` apenas em versão draft e rejeita chaves ausentes/extras, números inválidos, bloco zero, cobrança desconhecida e bloqueio clínico.
- A RPC de publicação bloqueia política nula/inválida e mantém todas as validações de custos, drivers, duplicidade, egress e reconciliação.
- O `catalog_snapshot` publicado inclui explicitamente `customCapacityPolicy`.
- O backend mapeia política nula/inválida para `null`, sem ativar blocos silenciosamente.
- O motor calcula blocos somente para catálogo `active` com política versionada válida.
- A tela financeira sugere “Catálogo comercial v3 — blocos de capacidade”, permite editar/salvar a política e explica que v2 fica inalterada até publicar v3.
- Na proposta, v2 sem política mantém limite/preço personalizados sem blocos; v3 publicada aplica a política.

As funcionalidades já concluídas de descontos temporários, fases promocionais, consentimento, notificações, Stripe assistido, modelos terapêuticos, cinco profissionais, planos multidisciplinares, ABA por especialidade, Checkout legado, redesign escolar e terminologia Sessão/Sessões foram preservadas.

## 2. Causa raiz

A migration tentava preencher a nova política em todas as versões existentes e torná-la obrigatória globalmente. O trigger `sales_pricing_catalog_versions_immutable_v1`, corretamente ativo, rejeitaria a alteração de v1/v2 com `PRICING_CATALOG_IMMUTABLE`. Em paralelo, o backend convertia `null` em política padrão, o que poderia habilitar blocos retroativamente em catálogo histórico.

## 3. Arquivos alterados

O manifesto completo de 24 arquivos está em `MANIFESTO.md`. Os arquivos centrais desta correção são:

- `supabase/migrations/20260728010000_sales_multidisciplinary_commercial_evolution.sql`
- `supabase/tests/20260728010000_sales_multidisciplinary_commercial_evolution_test.sql`
- `supabase/tests/20260728010000_sales_multidisciplinary_commercial_evolution_post_migration.sql`
- `server.ts`
- `src/components/SalesPricingCatalogPanel.tsx`
- `src/components/SalesModularProposalBuilder.tsx`
- `src/utils/salesCommercialEvolution.ts`
- `src/utils/salesModularCostDrivers.ts`
- `src/utils/salesModularProposal.ts`
- `tests/salesCapacityPolicyVersioning.test.ts`
- `tests/salesCommercialEvolution.test.ts`
- `tests/fixtures/salesModularFixture.ts`

## 4. Migration

Não foi criada migration posterior. Foi corrigida a migration ainda não aplicada:

`supabase/migrations/20260728010000_sales_multidisciplinary_commercial_evolution.sql`

Contrato final:

```sql
custom_capacity_policy is null
or public.sales_custom_capacity_policy_valid_v1(custom_capacity_policy)
```

Não existe backfill de catálogo publicado. Os únicos updates da coluna ocorrem no novo target draft do clone e no salvamento de draft. O update de catálogo ativo restante pertence exclusivamente ao fluxo normal de publicação, que arquiva v2 e ativa v3 sem enfraquecer o trigger.

Nenhum SQL foi executado no Supabase real.

## 5. Segurança e multi-tenant

- O trigger de imutabilidade foi mantido ativo e sem enfraquecimento.
- Clone, save e publish permanecem `security definer`, revogados para `anon`/`authenticated` e executáveis pelo backend via `service_role`.
- Salvamento exige status `draft`; active/archived retornam `PRICING_CATALOG_IMMUTABLE`.
- O frontend não é autoridade: a política é revalidada no backend e no banco.
- Stripe secret, service role, MFA, rate limit, request hash, idempotência, replay protection, RLS e isolamento por tenant permanecem inalterados.
- Nenhum dado clínico foi adicionado à Stripe.

## 6. Dados existentes e persistência

- v1/v2 não recebem política, não têm preços/custos alterados e não têm snapshot recalculado.
- A política é persistida no draft v3 e congelada no `catalog_snapshot` ao publicar.
- A proposta congela a capacidade e a política em `basePackage.capacity`; o Checkout reconstrói seu plano somente do snapshot aceito.
- Propostas, simulações, DRE, pagamentos, assinaturas, links Stripe e pending activations antigos não são alterados.
- O teste SQL compara hashes dos conteúdos lógicos de v1/v2 e dos snapshots históricos, DRE e estado Stripe.

## 7. Performance e banco

1. Nenhuma nova consulta por item foi criada.
2. Catálogo, itens, faixas e custos continuam carregados em lote.
3. O clone copia custos por relações set-based; não há fetch em loop no frontend.
4. A política é lida junto da versão do catálogo, sem chamada adicional.
5. O snapshot é materializado na publicação/proposta e reutilizado no Checkout.
6. Não foi criado cache cross-tenant.
7. Invalidação ocorre somente ao salvar/publicar o draft.
8. Impacto esperado: uma coluna JSONB na leitura já existente e zero round-trips adicionais.

## 8. Testes e resultados

- `npm ci`: aprovado na execução anterior desta mesma entrega; 423 pacotes auditados. Node local 22.17.0 versus engine 20.x; 16 vulnerabilidades preexistentes no lockfile. Nenhum `npm audit fix` executado.
- `npm run build`: aprovado; Vite 6.4.1, 3.127 módulos, 13,24 s na execução final. Permanecem avisos não bloqueantes de chunks grandes e importação mista de `dataService`.
- `npm test`: aprovado; 13/13 arquivos.
- `test:sales-capacity-versioning`: aprovado.
- `test:sales-commercial-evolution`: aprovado.
- `test:sales-modular-proposal`: aprovado.
- `test:sales-modular-flow`: aprovado.
- `test:sales-modular-stripe`: aprovado.
- Billing, Checkout legado/provisionamento, MFA, segurança, rentabilidade, clínica multidisciplinar e UI escolar: aprovados dentro de `npm test`.
- `node scripts/check-docker-runtime-imports.mjs`: aprovado; 59 arquivos.
- `git diff --check`: aprovado; somente avisos informativos de conversão LF/CRLF.

### Lint e typecheck

Não são declarados aprovados.

`npm run lint` e `npm run typecheck` executam `tsc --noEmit` e continuam falhando somente no erro ABA preexistente:

`src/server/abaRecommendationIdentity.ts(54,5): TS2353 — suggestion_key não existe em AbaClinicalRecommendation`.

Comprovação:

- foi o único erro emitido;
- `src/server/abaRecommendationIdentity.ts` não foi alterado;
- build e os 13 arquivos de teste passam;
- nenhum erro aponta para arquivo desta entrega.

### SQL

O teste transacional foi preparado, mas não executado porque esta entrega não possui conexão autorizada com PostgreSQL/Supabase local ou real.

Ele usa `BEGIN/ROLLBACK` e testa:

- trigger de imutabilidade ativo e tentativa de mutação da v2 bloqueada;
- v1/v2 nulas e hashes lógicos preservados;
- clone real v2 → v3 pelas RPCs;
- retry idempotente e conflito de payload;
- política padrão no draft, save válido e rejeição inválida;
- preservação de custos/drivers;
- publicação temporária, snapshot com política, v2 arquivada e único active;
- fórmulas 150/151/160/161/200;
- snapshots, DRE e estado Stripe imutáveis;
- restauração do catálogo ativo original após `ROLLBACK`.

## 9. Roteiro manual

1. Revisar o hash e aplicar manualmente a migration em ambiente controlado.
2. Executar o teste SQL transacional e confirmar ausência de exceções.
3. Executar as consultas pós-migration.
4. Confirmar v1 arquivada e v2 ativa com política nula.
5. Abrir Super Admin → Configurações financeiras.
6. Clicar em “Nova versão” e confirmar o nome sugerido “Catálogo comercial v3 — blocos de capacidade”.
7. Confirmar política 10 pacientes, R$ 79,90, 100 MB/paciente, 7 dias, próximo ciclo e acesso clínico preservado.
8. Salvar, atualizar a tela, sair/entrar e confirmar persistência do draft.
9. Validar que v2 continua ativa e inalterada antes da publicação.
10. Publicar v3 e confirmar: v3 active, v2 archived, somente um catálogo active.
11. Consultar o snapshot e confirmar `customCapacityPolicy`.
12. Montar proposta v2 histórica e confirmar ausência de blocos inventados.
13. Montar proposta v3 para 150/151/160/161/200 e validar 0/1/1/2/5 blocos.
14. Aceitar uma proposta test e confirmar que o Checkout usa a política congelada.
15. Revalidar Checkout legado, descontos, fases e fluxo clínico existente.

## 10. O que não foi alterado estruturalmente

- Nenhuma migration aplicada foi editada.
- Nenhuma migration posterior foi criada.
- Nenhum SQL real foi executado.
- Nenhuma branch, commit, push ou deploy foi criado.
- Nenhuma variável Railway foi alterada.
- O trigger de imutabilidade não foi removido, desabilitado ou enfraquecido.
- Checkout legado, cadastro público bloqueado, Stripe test/live, assinaturas, cupons, leads, DRE, MFA, RLS, multi-tenant, módulos clínicos, redesign escolar e Sessão/Sessões permanecem preservados.

## 11. Summary para commit e push

Summary sugerido:

`fix: versionar política de capacidade sem alterar catálogos publicados`

Descrição sugerida:

`Mantém v1/v2 sem política, aplica o padrão somente ao draft v3, valida save/publish, congela a política no snapshot e impede fallback histórico no motor modular.`

No GitHub Desktop: confirmar `Current branch: Main`, revisar os 24 arquivos do manifesto, aplicar/validar o SQL manualmente, criar o commit com o summary acima e usar `Push origin`. Não criar branch.
