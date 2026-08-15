# ADR — ABA V3 PR10: gráficos segmentados e rollout de piloto

## Decisão

PR10 prepara a V3 para um piloto controlado sem habilitar produção automaticamente. A entrega cria a superfície canônica de gráficos, um preflight de readiness e um writer operacional auditado para os gates já existentes. `FEATURE_ABA_V3_READ_API`, `FEATURE_ABA_V3_COLLECTION_API`, `FEATURE_ABA_V3_ROLLOUT_ADMIN` e `VITE_FEATURE_ABA_V3_UI` continuam `false` por padrão.

## Continuidade clínica dos gráficos

A API V3 não devolve uma única linha. `get_aba_target_chart_series_v3(...)` devolve segmentos identificados por modelo, fase, métrica e série clínica. Mudança de `phase_assignment_id` cria outro segmento. O renderer usa uma linha independente por segmento e `connectNulls=false`.

Legacy V2 não entra no read model V3. O histórico V2 continua disponível no painel Legacy, enquanto V3 aparece em uma área própria. Isso cria uma quebra de modelo ainda mais forte do que inserir um ponto nulo artificial e impede que percentuais V2 sejam reaproveitados como se tivessem a mesma semântica V3.

A view canônica cobre DTT/NET/probe, Task Analysis, maintenance probes, frequência, rate, duração e interval recording. IOA continua fora do gráfico clínico oficial do paciente e permanece como projeção de confiabilidade separada.

## ABC no primeiro piloto

ABC permanece **Legacy V2 only** no primeiro piloto. PR10 não cria um modelo ABC fictício. O trigger de vínculo comportamento -> target rejeita novos vínculos V3 para comportamentos `measurement_type = 'abc'`. Um eventual vínculo ABC antigo pode ser arquivado; não pode permanecer/ser criado como `ACTIVE`.

O preflight trata qualquer vínculo ABC V3 ativo como blocker. Isso mantém a coleta ABC funcionando no Legacy enquanto as demais famílias podem ser pilotadas em V3 sem mistura silenciosa.

## Preflight

`get_aba_v3_pilot_readiness(...)` avalia somente o escopo informado e é read-only. Ele bloqueia rollout quando encontra:

- ausência de target no escopo;
- collection definition V3 publicada ausente;
- fase V3 ativa ausente;
- Task Analysis sem passos publicados;
- vínculo ABC V3 ativo;
- itens de sync ainda em quarentena `OPEN/READY_FOR_RETRY`.

Sessões já abertas são informadas, mas não bloqueiam. O resolver usa `session.started_at`, então uma sessão iniciada antes do gate não muda de modelo no meio do atendimento.

## Writer operacional

`set_aba_measurement_rollout_state_v3(...)` é a única superfície operacional nova. Ela:

- aceita apenas administrador explícito da plataforma (`platform_admins.active=true`), com MFA exigido pelo Node;
- valida formato do escopo `CLINIC/PATIENT/PROGRAM/TARGET`;
- usa advisory lock por escopo;
- exige `expected_state_version` para optimistic locking quando fornecido;
- é idempotente quando o estado desejado já está aplicado;
- reaproveita os triggers de auditoria/versionamento PR1/PR2;
- exige preflight limpo antes de habilitar `PROGRAM` ou `TARGET`.

O Node adiciona uma segunda barreira: mutações de rollout só existem quando `FEATURE_ABA_V3_ROLLOUT_ADMIN=true`, e uma ativação é recusada se read API, collection API ou UI build flag não estiverem ligadas.

## Ordem segura do piloto

1. Aplicar migration e código com todas as flags V3 desligadas.
2. Em staging, ligar read API, collection API e UI. Isso ainda não cria novos bindings V3 porque os gates do banco continuam fechados.
3. Ligar temporariamente `FEATURE_ABA_V3_ROLLOUT_ADMIN=true`.
4. Rodar `npm run smoke:aba-v3-pilot` com sessão clínica para os reads e sessão `platform_admin` com MFA para readiness; nenhuma chamada do smoke altera rollout.
5. Criar/ativar gate `CLINIC`.
6. Criar/ativar gate `PATIENT`.
7. Criar/ativar somente `TARGET` ou `PROGRAM` aprovado no preflight.
8. Executar sessões controladas e revisar raw -> summary -> chart + fila de quarentena antes de expandir cohort.

## Rollback sem perder offline

Rollback não começa desligando sync. Primeiro definir `allow_new_v3_sessions=false` no escopo de enrollment, mantendo `accept_v3_sync=true`. Isso impede novos bindings V3, mas permite que eventos legitimamente coletados por sessões V3 existentes terminem de sincronizar. Após zerar outbox/quarentena e encerrar sessões pendentes, definir `accept_v3_sync=false`.

Bindings já materializados continuam imutáveis e históricos V3 permanecem legíveis. Não há conversão para V2 nem deleção retroativa.
