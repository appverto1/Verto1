# ABA Measurement V3 — arquitetura congelada para dark deploy

Status: **aprovada para implementação aditiva**  
Escopo deste primeiro pacote: documentação + fundação de banco.  
Impacto clínico imediato: **nenhum**.

## 1. Princípios invariantes

1. `ABA Legacy V2` permanece legível e operacional. Nenhum dado V2 é reescrito para fingir semântica V3.
2. V3 é aditiva. Não existe backfill de oportunidade independente, cadeia de prompts, tempo ativo observado ou versão de protocolo quando esses fatos não foram coletados originalmente.
3. Evento clínico bruto efetivo é a fonte de verdade. Summaries são projeções server-side recalculáveis.
4. Nenhum score geral de progresso do paciente e nenhum score ponderado de prompt são autoridade clínica da V3.
5. Fase clínica e versão do instrumento de coleta têm ciclos de vida ortogonais.
6. O modelo de mensuração é congelado por `(session_id, target_id)` quando o alvo entra na sessão.
7. Uma ativação V3 no meio de uma sessão nunca converte retrospectivamente o binding já criado.
8. Dados offline são interpretados pela versão original identificada pelo dispositivo, nunca pela versão atualmente vigente no servidor.
9. Versão `DEPRECATED` continua válida para ingestão histórica/offline. Versão inexistente ou cross-tenant entra em quarentena; nunca recebe De/Para manual para uma versão nova.
10. `accept_v3_sync` e `allow_new_v3_sessions` são controles independentes. Rollback de UI nunca impede a sincronização de dados V3 já coletados.
11. Um target que iniciou V3 não volta silenciosamente para V2. Continuidade emergencial, quando implementada, usa um episódio auditado de `EMERGENCY_LEGACY_BRIDGE` sem unir matematicamente as séries.
12. Migration estrutural V3 evolui para frente; rollback operacional usa feature gates, não `DROP TABLE`.

## 2. Unidade de rollout

A elegibilidade pode ser limitada por clínica, paciente e programa, mas a unidade técnica final de ativação é o **target**. O binding efetivo é sempre por sessão + target.

Hierarquia de rollout prevista:

`GLOBAL (aplicação) -> CLINIC -> PATIENT -> PROGRAM -> TARGET`

O primeiro dark deploy cria somente os escopos persistidos por organização. A lógica de resolução entra em PR posterior.

## 3. Binding imutável por sessão + alvo

`aba_session_target_measurement_bindings` é a proteção contra mid-session upgrade.

Exemplo:

- 14:00: sessão abre; Target A é ligado a `LEGACY_V2`.
- 14:30: coordenador habilita V3 para Target A.
- 14:35: a sessão aberta continua V2.
- próxima sessão: o resolver pode criar binding V3.

O binding já persistido não muda.

## 4. Fases clínicas e versões de coleta

`aba_target_phase_assignments_v3` representa o episódio/fase clínica do target em janela half-open `[effective_from, effective_until)`. Somente segmentos clínicos que particionam a série pertencem a essa tabela; eventos pontuais de contexto/goal change permanecem eventos/markers e não competem com a exclusion constraint temporal.

`aba_collection_definition_versions_v3` representa a definição imutável usada para interpretar a coleta.

Não existe FK obrigatória de versão dentro do assignment. Um mesmo assignment clínico pode usar várias versões de coleta quando a semântica clínica da fase não mudou.

Um trial V3 futuro apontará separadamente para:

- `target_phase_assignment_id`;
- `collection_definition_version_id`.

Uma correção ortográfica em um prompt pode criar nova versão de coleta sem forçar nova fase e sem quebrar a série clínica.

## 5. Offline e temporalidade

Um evento offline pode referenciar assignment já encerrado no momento do sync. A validação futura deve usar `occurred_at` contra `[effective_from, effective_until)`, não o estado atual do assignment.

Uma versão de coleta arquivada/deprecated continua aceitável se for a versão original do evento. O registro deve carregar a sinalização `protocol_version_deprecated_at_sync` no estágio de persistência V3.

## 6. Complex trials

A V3 futura usa envelope + steps relacionais. O envelope não grava simultaneamente `correct`, `independent` ou score como segunda fonte de verdade.

Cada trial possui no máximo uma oportunidade `PRIMARY_INDEPENDENT`. Cadeias de correção/least-to-most podem possuir múltiplos steps, mas uma tentativa contribui no máximo 1 vez para o denominador de oportunidade independente primária.

O fast path envia intenção + `collection_definition_version_id`; o servidor materializa os steps segundo a versão congelada.

## 7. Comportamento, taxa e IOA

Taxa usa tempo ativo observado do alvo, representado futuramente por slices líquidos. Duração total da sessão não substitui `active_observation_time`.

Overlap é proibido somente para o mesmo `(session_id, behavior_id, context_id, collector_user_id)`. Observadores diferentes podem monitorar simultaneamente o mesmo comportamento.

O summary oficial usa somente o coletor `PRIMARY`. Observador `RELIABILITY` alimenta IOA separadamente.

Conflitos de overlap em bulk sync não devem abortar o lote inteiro. Duplicatas idempotentes podem ser deduplicadas; conflitos reais são isolados/quarentenados, nunca mesclados silenciosamente quando isso puder alterar significado clínico.

## 8. Probes e FSM

Probe possui lifecycle separado de interpretação: `OPEN`, `COMPLETE`, `INCOMPLETE`, `CANCELLED`.

No fechamento da sessão, probes abertas são fechadas atomicamente: N suficiente -> `COMPLETE`; N insuficiente -> `INCOMPLETE`.

Somente probe `COMPLETE` e elegível pode alimentar a FSM. `INCOMPLETE` não é sucesso nem falha.

Transições clínicas finais continuam humanas; alertas automáticos descrevem fatos observáveis, não “melhora clinicamente significativa”.

## 9. Exposure por sessão + alvo

Ausência de oportunidade é um estado rastreável da exposição, não um trial falso.

Estados previstos: `COLLECTED`, `NO_OPPORTUNITY`, `NOT_COLLECTED`, `NOT_APPLICABLE`, `INCOMPLETE`.

A chegada do primeiro trial válido promove deterministicamente o estado corrente para `COLLECTED`, preservando a transição anterior em auditoria. Se já existem trials efetivos, o backend não permite declarar `NO_OPPORTUNITY`.

## 10. Retificação e summaries

Correções clínicas são append-only (`VOID`, `CORRECT`, `SUPERSEDE`, `RESTORE`). Não há hard delete de evento clínico como fallback.

Summaries V3 serão normalizados por `session_id + target_id + target_phase_assignment_id` e recalculados no servidor apenas para o target/fase afetado. O browser nunca envia percentuais como autoridade.

## 11. Kill switches

Dois controles obrigatórios e independentes:

- `allow_new_v3_sessions`: autoriza novos bindings V3.
- `accept_v3_sync`: autoriza recebimento/reprocessamento de dados V3 já coletados.

Ordem segura de ativação: `accept_v3_sync = true` antes de `allow_new_v3_sessions = true`.

Ordem segura de contingência: `allow_new_v3_sessions = false`, mantendo `accept_v3_sync = true` enquanto houver dispositivos com dados pendentes.

## 12. Risco de interpretação retroativa

Toda evolução futura deve ser classificada como:

- `NONE`: não inventa significado histórico;
- `LEGACY_ONLY`: dado permanece interpretável apenas pela semântica V2;
- `FORBIDDEN`: exigiria inferir fato que não foi coletado.

Qualquer transformação `FORBIDDEN` é rejeitada por design.

## 13. Escopo do primeiro dark deploy

Este pacote cria apenas:

- versões imutáveis de definição de coleta;
- assignments temporais por target;
- estados de rollout com gates desligados;
- binding estrutural por sessão + target;
- trilha de auditoria de rollout;
- constraints, índices e RLS fail-closed.

Não cria trials V3, não altera APIs clínicas, não altera frontend, não mexe em summaries V2 e não ativa V3 para nenhuma clínica.
