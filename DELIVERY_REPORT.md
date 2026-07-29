# Relatório de entrega — escopo de política apenas para propostas personalizadas

## Estado da entrega

A implementação solicitada foi aplicada sobre a mesma base recebida, sem reiniciar a tarefa. Foram alterados **exatamente seis arquivos do projeto**.

A implementação funcional está preparada, mas esta entrega **não é declarada como integralmente aprovada** porque o worktree disponível continua parcial. A suíte oficial, o build, a verificação Docker, lint e typecheck não puderam completar. O teste SQL também não foi executado, conforme a proibição expressa de execução de SQL.

## Correções implementadas

### 1. Teste SQL na primeira execução

O teste agora mantém duas políticas separadas:

- `clone_default_policy`: reprodução exata do fallback da função `clone_sales_pricing_catalog_version_v3` da migration, com 60/70/80/75/75/70;
- `policy`: política dinâmica 55/65/70/70/75 utilizada para salvar e publicar o draft durante a validação.

A expectativa do clone passou a ser:

```sql
expected_clone_policy := coalesce(source_policy, clone_default_policy);
```

O teste primeiro valida a política herdada ou o fallback correto do clone. Somente depois salva explicitamente a política 55/65/70/75 e publica o draft.

Foram preservados `BEGIN`, `ROLLBACK`, idempotência, hashes históricos, ausência de backfill e verificações de Checkout e ativações.

A migration `supabase/migrations/20260728020000_sales_modular_profitability_policy.sql` não foi alterada. SHA-256 preservado:

`5a85083c0591e9c3f6bb55ffd8bbd8fbfdda424fe5ea7d6538b80ec80a969d5a`

### 2. Política obrigatória somente para pacote personalizado

Foi criada a função compartilhada:

```ts
salesModularProposalRequiresVersionedProfitabilityPolicy(input, catalog)
```

Ela usa exclusivamente a configuração server-side da faixa `clinical_core` indicada por `basePackageTierId` e retorna `true` quando:

- `isCustom === true`; ou
- `maximumQuantity === null`.

A função não usa quantidade acima de 100, sinalizador livre do navegador, query, RPC ou fetch.

### 3. Salvamento e preview

- Faixa personalizada sem política válida: permanece bloqueada com HTTP 409 e `PRICING_PROFITABILITY_POLICY_REQUIRED`.
- Faixa padrão sem política: mantém preview e salvamento legados.
- Ausência de política mantém `economics = null`; não cria custos ou margens artificiais iguais a zero.
- Trocar a faixa atual entre padrão e personalizada remove ou restaura o aviso imediatamente.

### 4. Proposta pública

- Simulação padrão ainda não publicada sem política não sofre o bloqueio global.
- Simulação personalizada exige política e snapshot econômico versionados.
- Oferta já publicada é recuperada por leitura do registro existente, com os dados determinísticos do mesmo link público, sem carregar catálogo, recalcular economia, chamar a RPC de criação ou executar escrita.
- A autoridade final continua no servidor.

### 5. Preservações

Não foram alterados os cálculos financeiros, códigos neutros ou legados, política 55/65/70/75 existente, aprovação excepcional, MFA, confirmação, justificativa, `policyHash`, `resultHash`, snapshots, DTO público, Stripe, Checkout, Subscription Schedule, Railway ou migration.

## Arquivos do projeto alterados

1. `server.ts`
2. `src/components/SalesModularProposalBuilder.tsx`
3. `src/utils/salesModularProposal.ts`
4. `supabase/tests/20260728020000_sales_modular_profitability_policy_test.sql`
5. `tests/salesModularEconomics.test.ts`
6. `tests/salesProfitabilityPolicyVersioning.test.ts`

## Ações não realizadas

Não houve commit, push, criação de branch, deploy, alteração no Railway ou execução de SQL.

## Pendência objetiva para aprovação final

Aplicar estes seis arquivos no worktree completo e executar a matriz descrita em `MANUAL_VALIDATION.md`. Em especial, o teste SQL precisa ser realmente executado nos dois cenários de banco solicitados antes de declarar conclusão integral.
