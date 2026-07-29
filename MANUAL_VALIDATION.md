# Roteiro manual de validação no worktree completo

## 1. Aplicar somente os seis arquivos

Faça backup dos caminhos existentes e substitua apenas:

- `server.ts`
- `src/components/SalesModularProposalBuilder.tsx`
- `src/utils/salesModularProposal.ts`
- `supabase/tests/20260728020000_sales_modular_profitability_policy_test.sql`
- `tests/salesModularEconomics.test.ts`
- `tests/salesProfitabilityPolicyVersioning.test.ts`

Não copie os arquivos de relatório para dentro do código-fonte caso não deseje versioná-los.

## 2. Confirmar preservação de escopo

No repositório completo:

```powershell
git status --short
git diff -- server.ts src/components/SalesModularProposalBuilder.tsx src/utils/salesModularProposal.ts supabase/tests/20260728020000_sales_modular_profitability_policy_test.sql tests/salesModularEconomics.test.ts tests/salesProfitabilityPolicyVersioning.test.ts
git diff --check
```

Confirme que a migration não mudou:

```powershell
Get-FileHash .\supabase\migrations\20260728020000_sales_modular_profitability_policy.sql -Algorithm SHA256
```

Hash esperado: `5A85083C0591E9C3F6BB55FFD8BBD8FBFDDA424FE5EA7D6538B80EC80A969D5A`.

## 3. Instalar e executar a suíte oficial

```powershell
npm ci
npm test
npm run test:sales-commercial-exceptions
npm run test:sales-personalized-per-patient
npm run test:sales-profitability-policy-versioning
npm run test:sales-capacity-versioning
npm run test:sales-modular-economics
npm run test:sales-modular-stripe
npm run test:security
npm run build
npm run check:docker-runtime-imports
npm run lint
npm run typecheck
git diff --check
```

Registre o exit code real de cada comando. Compare qualquer erro ABA com o baseline anterior; não aceite erro novo.

## 4. Executar manualmente o teste SQL

Nenhum SQL foi executado nesta entrega. No ambiente apropriado, execute manualmente:

`supabase/tests/20260728020000_sales_modular_profitability_policy_test.sql`

O arquivo contém `BEGIN` e `ROLLBACK`.

Valide separadamente:

1. primeira execução após a migration, quando o catálogo ativo histórico possui `profitability_policy null`;
2. reexecução após uma nova versão legítima ter sido publicada com política válida.

Nos dois casos, o teste deve completar sem exceção e encerrar com `ROLLBACK`.

## 5. Verificação manual da interface

1. Abra o construtor com catálogo ativo histórico sem política.
2. Selecione uma faixa padrão com máximo definido e `isCustom=false`.
3. Confirme preview disponível, botão de salvar disponível e ausência do bloqueio de política.
4. Confirme que métricas econômicas ausentes não aparecem como `0`.
5. Troque para faixa `isCustom=true` ou `maximumQuantity=null`.
6. Confirme aviso, orientação para clonar/revisar/publicar e bloqueio do salvamento.
7. Volte à faixa padrão e confirme remoção imediata do bloqueio.
8. Selecione uma simulação padrão histórica ainda não publicada e gere a proposta pública.
9. Tente gerar nova proposta a partir de personalizada histórica sem política e confirme HTTP 409 com `PRICING_PROFITABILITY_POLICY_REQUIRED`.
10. Recupere uma oferta já publicada e confirme mesmo ID e mesma URL, sem alteração do snapshot.
11. Com política válida 55/65/70/75, confirme cálculos, textos, classificação e aprovação excepcional.
12. Inspecione a resposta pública e confirme ausência de política, custos, margens, aprovação e justificativa.

## 6. Encerramento

Não executar commit, push, branch, deploy, Railway ou SQL automatizado como parte da aplicação destes arquivos.
