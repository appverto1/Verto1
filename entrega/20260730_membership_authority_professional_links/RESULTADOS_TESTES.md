# Resultados de validação

Data: 30/07/2026

## Comandos aprovados

| Comando | Exit code | Resultado |
|---|---:|---|
| `npm ci` | 0 | Dependências instaladas pelo lockfile; aviso de engine porque o projeto declara Node 20.x e o ambiente usa Node 22.17.0. |
| `npm test` | 0 | 20 arquivos de teste aprovados. |
| `npm run test:clinical-multidisciplinary` | 0 | Regressão clínica multidisciplinar aprovada. |
| `node_modules/.bin/tsx.cmd tests/clinicalProfessionalLinksHistory.test.ts` | 0 | Teste comportamental focado aprovado. |
| `npm run test:security` | 0 | Regressão de segurança aprovada. |
| `npm run build` | 0 | Build Vite aprovado; 3.131 módulos transformados. |
| `npm run check:docker-runtime-imports` | 0 | 62 arquivos cobertos. |
| `git diff --check` | 0 | Sem erro de whitespace; somente avisos informativos LF/CRLF. |

O primeiro acionamento do teste focado por `npx` não iniciou porque o Windows
bloqueou `npx.ps1`. Ele não é contabilizado como execução de teste. O mesmo
teste foi executado pelo binário `.cmd` do projeto e aprovado.

## Lint e typecheck

| Comando | Exit code | Resultado |
|---|---:|---|
| `npm run lint` | 1 | Falha exclusivamente no baseline ABA preexistente. |
| `npm run typecheck` | 1 | A mesma e única falha ABA preexistente. |

Erro preservado:

```text
src/server/abaRecommendationIdentity.ts(54,5): error TS2353:
Object literal may only specify known properties, and 'suggestion_key'
does not exist in type 'AbaClinicalRecommendation'.
```

Comprovação:

- nenhum arquivo ABA consta no diff;
- `git diff -- src/server/abaRecommendationIdentity.ts` não possui saída;
- nenhum diagnóstico novo foi emitido por lint/typecheck;
- os seis arquivos TypeScript/TSX alterados passaram por transpilação sintática
  isolada;
- build, suíte completa e testes focados foram aprovados.

## Cobertura comportamental adicionada

Os testes exercitam as funções de produção usadas pelas rotas para comprovar:

- membership therapist ativa com `users.clinic_id` correto, nulo ou divergente;
- rejeição sem membership, com membership inativa, de outro tenant ou com papel
  coordinator;
- rejeição sem perfil ou sem especialidade válida;
- vínculo inconsistente visível, sanitizado, contado e sem acesso;
- encerramento autorizado com uma persistência e negação com zero persistência;
- manager por membership ativa, independentemente de `users.role`;
- owner/admin global preservado;
- read/write dependentes de link, membership, perfil e permissões;
- ausência de N+1 na composição e nas rotas;
- presença das proteções transacionais, locks, signatures, grants e policies
  nas migrations.

## Alertas não bloqueantes

- `npm ci` relatou 16 vulnerabilidades do inventário atual
  (2 low, 7 moderate, 6 high e 1 critical). `npm audit fix` não foi executado,
  pois está fora do escopo e poderia alterar dependências.
- o build manteve os avisos existentes de chunks grandes e importação
  simultaneamente estática/dinâmica de `dataService.ts`.

## SQL e validação visual

Nenhuma migration foi executada, conforme solicitado. Por isso não foi possível
validar ponta a ponta as policies/RPCs contra o Supabase nem persistir e
recarregar um vínculo real.

A renderização do estado inconsistente foi validada por componente e build. A
validação autenticada com coordinator/owner, banco de teste e reload permanece
manual e está descrita em `ROTEIRO_MANUAL.md`.
