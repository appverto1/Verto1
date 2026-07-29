# Resultados dos testes

Data: 28/07/2026

| Validação | Resultado |
|---|---|
| `npm ci` | aprovado; 423 pacotes instalados |
| `npm test` | aprovado; 15 arquivos de teste |
| `npm run build` | aprovado; 3.128 módulos transformados |
| `npm run lint` | falhou somente no erro ABA preexistente |
| `npm run typecheck` | falhou somente no erro ABA preexistente |
| `node scripts/check-docker-runtime-imports.mjs` | aprovado; 60 arquivos cobertos |
| `git diff --check` | aprovado |
| Teste SQL transacional | não executado; SQL real proibido |

Erro preexistente de lint/typecheck:

```text
src/server/abaRecommendationIdentity.ts(54,5): TS2353
'suggestion_key' does not exist in type 'AbaClinicalRecommendation'
```

O arquivo ABA não foi alterado. Build e todos os arquivos de teste desta entrega passam; o typecheck completo não apresentou erro novo.

Avisos não bloqueantes:

- o build preserva os avisos já existentes de chunks grandes e importação estática/dinâmica de `dataService.ts`;
- `npm ci` informou 16 vulnerabilidades no grafo atual (2 baixas, 7 moderadas, 6 altas e 1 crítica); nenhuma dependência foi atualizada nesta entrega;
- a máquina executou Node 22.17.0, enquanto o projeto declara Node 20.x.

Cobertura econômica explícita:

- core isolado e custo compartilhado único;
- módulos sem repetição de custo fixo;
- módulo com margem superior/inferior e efeito na margem consolidada;
- pisos de 60%, 70%, 75% e 80%;
- desconto temporário, módulo gratuito e condição posterior;
- recálculo ao remover módulo;
- capacidade e excedentes;
- Agenda, Financeiro, TISS e Escolar pelos drivers corretos;
- Stripe percentual, impostos e inadimplência;
- reconciliação em centavos;
- snapshot e catálogo histórico;
- bloqueio no envio e no Checkout congelado.
