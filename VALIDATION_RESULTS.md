# Resultados reais de validação

## Status geral

**Não aprovado integralmente neste ambiente.**

Os testes auxiliares executáveis no recorte passaram. Os comandos oficiais foram iniciados literalmente, mas falharam antes de completar por ausência de arquivos e dependências do worktree completo. Nenhum comando com falha foi classificado como aprovado.

## Validações auxiliares aprovadas

| Validação | Resultado |
|---|---:|
| Transpilação sintática de `server.ts`, componente, utilitários, fixture e testes relevantes | PASS |
| `salesCommercialEvolution.test.ts` | PASS |
| `salesCommercialExceptionApproval.test.ts` | PASS |
| `salesModularEconomics.test.ts` | PASS |
| `salesPersonalizedPerPatientPricing.test.ts` | PASS |
| `salesProfitabilityPolicyVersioning.test.ts` | PASS |
| Verificação estrutural dos 26 invariantes do escopo | PASS |
| Whitespace por `git diff --no-index --check` nos seis arquivos | PASS |
| Marcadores de conflito | Ausentes |
| Migration existente byte a byte preservada | PASS |

Os logs estão em `validation_logs/auxiliary/`.

## Comandos oficiais

| Comando | Exit | Resultado real | Motivo principal |
|---|---:|---|---|
| `npm ci` | 1 | FAIL | `package-lock.json`/`npm-shrinkwrap.json` ausente |
| `npm test` | 1 | FAIL | `scripts/run-tests.mjs` ausente |
| `npm run test:sales-commercial-exceptions` | 127 | FAIL | `tsx` não instalado |
| `npm run test:sales-personalized-per-patient` | 127 | FAIL | `tsx` não instalado |
| `npm run test:sales-profitability-policy-versioning` | 127 | FAIL | `tsx` não instalado |
| `npm run test:sales-capacity-versioning` | 127 | FAIL | `tsx` não instalado |
| `npm run test:sales-modular-economics` | 127 | FAIL | `tsx` não instalado |
| `npm run test:sales-modular-stripe` | 127 | FAIL | `tsx` não instalado |
| `npm run test:security` | 1 | FAIL | `tests/security.regression.test.mjs` ausente |
| `npm run build` | 127 | FAIL | `vite` não instalado |
| `npm run check:docker-runtime-imports` | 1 | FAIL | script de verificação ausente |
| `npm run lint` | 1 | FAIL | `tsconfig.json` ausente; `tsc` exibiu ajuda |
| `npm run typecheck` | 1 | FAIL | `tsconfig.json` ausente; `tsc` exibiu ajuda |
| `git diff --check` | 129 | FAIL | diretório sem metadados `.git` |

Os logs integrais estão em `validation_logs/official/`.

## Build e Docker

- **Build:** não aprovado. `npm run build` iniciou, mas `vite` não estava disponível.
- **Docker runtime imports:** não aprovado. O script `scripts/check-docker-runtime-imports.mjs` não existe no recorte.
- **Baseline ABA:** não foi possível executar a suíte oficial nem comparar o erro ABA preexistente. Portanto, não há alegação de ausência de regressão global por baseline.

## Teste SQL

O SQL **não foi executado**, conforme instrução expressa. A análise estrutural comprovou:

- `clone_default_policy` é idêntica ao fallback da migration;
- `expected_clone_policy` usa `coalesce(source_policy, clone_default_policy)`;
- a política 55/65/70/75 é salva somente após validar o clone;
- `BEGIN`, `ROLLBACK`, hashes, ausência de backfill, Checkout e ativações permanecem no teste.

Isso valida a correção do arquivo, mas não substitui a execução real nos dois estados de banco.

## Cobertura dos 18 requisitos

| # | Requisito | Evidência neste ambiente |
|---:|---|---|
| 1 | Clone de origem `null` recebe `clone_default_policy` | PASS estrutural; igualdade JSON exata com a migration |
| 2 | Política 55/65/70/75 salva e publica após o clone | PASS estrutural |
| 3 | SQL passa na primeira execução pós-migration | PENDENTE: SQL não executado |
| 4 | SQL passa com origem já versionada | PENDENTE: SQL não executado; caminho `coalesce(source_policy, ...)` validado estruturalmente |
| 5 | Personalizada sem política retorna 409 | PASS estrutural do guard server-side; integração HTTP pendente |
| 6 | Padrão sem política não retorna 409 | PASS da função compartilhada e ausência do bloqueio global; integração HTTP pendente |
| 7 | Padrão sem política gera preview | PASS em runtime do motor |
| 8 | Padrão sem política pode ser salva | PASS em runtime da classificação; persistência integrada pendente |
| 9 | Padrão histórica não publicada gera proposta pública | PASS estrutural do guard; integração pendente |
| 10 | Personalizada histórica sem política não gera nova proposta | PASS estrutural do guard |
| 11 | Publicada continua recuperável sem recálculo | PASS estrutural do caminho read-only |
| 12 | Padrão → personalizada ativa aviso | PASS em runtime da função e teste estático da UI |
| 13 | Personalizada → padrão remove bloqueio | PASS em runtime da função e teste estático da UI |
| 14 | Ausência de política não produz zero artificial | PASS em runtime |
| 15 | Política válida mantém 55/65/70/75 | PASS nos testes econômicos/versionamento |
| 16 | Aprovação excepcional permanece válida | PASS em runtime |
| 17 | `policyHash` continua validado | PASS no teste de aprovação/versionamento |
| 18 | DTO público continua sanitizado | PASS estrutural no teste de versionamento |
