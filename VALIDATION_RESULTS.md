# Resultados de validação

## Validações aprovadas

| Validação | Resultado | Exit code |
|---|---|---:|
| `clinicInvitationDelivery.test.ts` | Passou | 0 |
| `clinicalSpecialtiesFrontend.test.ts` | Passou | 0 |
| `clinicalSpecialtyTherapeuticPlans.test.ts` | Passou | 0 |
| `clinicMembershipAuthority.test.ts` | Passou | 0 |
| `therapeuticPlanAccess.test.ts` | Passou | 0 |
| `clinicalMultidisciplinaryEvolution.test.ts` | Passou | 0 |
| `security.regression.test.mjs` | Passou | 0 |
| `check-docker-runtime-imports.mjs` | 65 arquivos de runtime cobertos | 0 |
| Transpilação sintática dos 5 arquivos TS/TSX alterados | Passou | 0 |
| Verificação de whitespace dos 8 arquivos | Passou | 0 |
| `check-resend-configuration.mjs` sem credenciais | Falha controlada esperada; informa variáveis ausentes | 2 |

## Execução auxiliar da suíte

Como o `npm ci` não conseguiu concluir neste ambiente, foi usado um loader TypeScript local apenas para executar os testes que não dependem dos pacotes removidos pela instalação interrompida.

- 24 arquivos de teste passaram.
- 2 não iniciaram por dependências locais ausentes:
  - `patientListVisibility.test.ts`: pacote `@supabase/supabase-js` sem conteúdo instalado;
  - `salesModularCapacityBlockPricing.test.ts`: pacote `react` sem conteúdo instalado.

Essas duas ocorrências são bloqueios ambientais, não falhas de asserção.

## Comandos oficiais não aprovados

| Comando | Resultado real | Exit code |
|---|---|---:|
| `npm ci` | Registry interno retornou 404 para `yallist-3.1.1.tgz`; Node disponível é 22, enquanto o projeto declara 20.x | 1 |
| `npm run build` | `vite` não disponível após o `npm ci` interrompido | 127 |
| `npm test` | runner tentou iniciar `tsx`, indisponível após a instalação interrompida | 1 |
| `npm run typecheck` | definição `vite/client` ausente após a instalação interrompida | 2 |
| `npm run lint` | mesma ausência de `vite/client` | 2 |

Nenhum desses comandos é declarado aprovado. Antes da tentativa de `npm ci`, o histórico fornecido no próprio worktree registrava build e suíte anteriores aprovados para o trabalho de especialidades/PTS; isso não substitui uma nova execução oficial deste patch.

## Restrições respeitadas

- Nenhum SQL executado.
- Nenhuma migration criada ou modificada.
- Nenhum deploy.
- Nenhuma alteração no Railway.
- Nenhum commit, push ou branch.
- Nenhum segredo incluído nos arquivos.
