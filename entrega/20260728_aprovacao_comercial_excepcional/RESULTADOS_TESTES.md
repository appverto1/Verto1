# Resultados de validação

Data: 28/07/2026

## Aprovados

- `npm test`
  - aprovado;
  - 17 arquivos de regressão executados, incluindo billing, clínica
    multidisciplinar, MFA, capacidade, Checkout, evolução comercial,
    aprovação excepcional, economia modular, proposta modular, preço por
    paciente, fluxo legado, Stripe modular e segurança.
- testes comerciais específicos
  - aprovados dentro de `npm test` e repetidos isoladamente;
  - `npm run test:sales-commercial-exceptions`: aprovado;
  - `npm run test:sales-personalized-per-patient`: aprovado;
  - `npm run test:sales-profitability-policy-versioning`: aprovado;
  - `npm run test:sales-modular-flow`: aprovado;
  - `salesCommercialExceptionApproval.test.ts` cobre classificação,
    autorização, MFA, confirmação, justificativa, hash, não reutilização,
    schema pendente, DTO público e cenário estratégico sem nome hardcoded.
- `npm run test:security`
  - aprovado isoladamente.
- `npm run build`
  - aprovado;
  - 3.128 módulos transformados;
  - permaneceram apenas avisos já conhecidos de chunk grande e importação
    dinâmica/estática.
- `node scripts/check-docker-runtime-imports.mjs`
  - aprovado;
  - 60 arquivos validados.
- `git diff --check`
  - aprovado;
  - apenas avisos informativos de conversão LF/CRLF do Git.
- render local do build de produção
  - aprovado em `127.0.0.1`;
  - nenhuma variável real do Railway foi alterada.

## Lint e typecheck

`npm run lint` e `npm run typecheck` executam o mesmo comando `tsc --noEmit`.
Ambos continuam falhando somente no erro ABA preexistente:

```text
src/server/abaRecommendationIdentity.ts(54,5): error TS2353:
'suggestion_key' does not exist in type 'AbaRecommendationIdentityInput'.
```

Comprovação:

- `git diff -- src/server/abaRecommendationIdentity.ts` não possui saída;
- nenhum arquivo ABA foi alterado nesta entrega;
- nenhum erro novo aparece no resultado do TypeScript;
- build e testes dos arquivos alterados foram aprovados.

## Validação visual

O build de produção foi aberto no navegador local em desktop e renderizou
corretamente. A página pública confirmou a terminologia clínica
Sessão/Sessões.

O construtor comercial protegido não pôde ser exercitado visualmente com
owner+MFA porque não havia credencial/sessão de teste disponível no ambiente.
Essa validação não foi simulada nem declarada como aprovada; o roteiro completo
está em `ROTEIRO_MANUAL.md`.

## SQL

Nenhuma migration, consulta pós-migration ou teste SQL foi executado contra
Supabase real.
