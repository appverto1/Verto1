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

## 14. PR2 — resolução imutável do binding

PR2 adiciona o resolver server-side, ainda sem qualquer rota clínica V3.

A decisão de um target dentro de uma sessão usa **`aba_sessions.started_at`** como
`decision_at`. Ela nunca usa o horário do request/sync. Isso protege sessões que
começaram antes de uma ativação e só chegaram ao servidor depois por operação
offline.

A resolução dos gates é histórica: lê a trilha append-only de
`aba_measurement_rollout_events_v3` e seleciona o estado cuja `effective_from`
já valia em `decision_at`.

Para o primeiro piloto a política é deliberadamente fail-closed:

1. gate `CLINIC` precisa estar habilitado;
2. gate `PATIENT` precisa estar habilitado;
3. `TARGET` prevalece sobre `PROGRAM`; um dos dois precisa estar habilitado;
4. `allow_new_v3_sessions` **e** `accept_v3_sync` precisam estar verdadeiros em
todos os gates aplicáveis antes de um novo binding V3 ser criado.

Se `allow_new_v3_sessions` ainda não valia no início da sessão, o binding é
`LEGACY_V2`. Se V3 estava autorizada mas o sync não estava preparado, o resolver
falha fechado e não inicia coleta nova sob um estado operacional incoerente.

O binding grava um snapshot de decisão (`rollout_snapshot`) e a razão utilizada.
Depois de persistido, continua imutável.

### Mudanças de gate

A identidade de um rollout state é imutável. Quando os switches mudam, a alteração
precisa de uma nova `effective_from` não retroativa. Isso impede que uma ativação
de hoje altere a interpretação de uma sessão que começou ontem.

### Pré-requisitos para V3

Um binding V3 só é criado quando, no `session.started_at`, existem:

- versão de coleta válida para o target/programa;
- assignment de fase válido para o target;
- rollout completo e consistente.

Uma definição que foi descontinuada **depois** do início da sessão continua válida
para aquela sessão offline/histórica.

### Emergency Legacy Bridge

PR2 cria somente a infraestrutura server-side e auditável do bridge. Não existe
writer de navegador nem controle de UI neste estágio. Um bridge ativo representa
um episódio de mensuração separado `EMERGENCY_LEGACY_BRIDGE`; ele não reescreve o
estado histórico V3 e não une séries V2/V3 matematicamente.

### Concorrência

A resolução serializa somente `(organization_id, session_id, target_id)` via
advisory transaction lock. Targets diferentes não competem entre si.

A constraint `UNIQUE(session_id, target_id)` continua sendo a proteção final. Em
retry/race, o binding que já venceu é retornado; nunca é reescrito.

## 15. PR3 — persistência raw V3 e sincronização offline

PR3 cria a primeira superfície de persistência V3, ainda sem interface clínica e sem
qualquer alteração de rota V2.

### Envelope e cadeia intra-trial

`aba_trials_v3` guarda somente identidade/contexto imutável. Resultado clínico não
é duplicado no envelope. A sequência efetiva fica em `aba_trial_steps_v3`.

Um complex trial é commitado numa única transação:

`envelope + N steps + exposure`

ou nada entra. `UNIQUE(trial_id, sequence_no)` impede repetição dos steps e um
índice único parcial garante no máximo uma oportunidade `PRIMARY_INDEPENDENT` por
trial.

### Bulk e idempotência

A operação canônica é `record_aba_trials_bulk_v3(...)`. A chave de retry do
cliente é `(organization_id, client_event_id)`. Mesmo identificador + mesmo hash é
no-op idempotente; mesmo identificador + payload diferente não sobrescreve o dado
original e vai para quarentena.

Bindings são resolvidos apenas uma vez por par distinto sessão + target dentro do
lote. A operação nunca faz uma RPC por trial.

### Offline histórico

A versão informada pelo dispositivo precisa existir e ser exatamente a versão
congelada no binding. Se ela foi descontinuada depois, continua válida e o trial
recebe `protocol_version_deprecated_at_sync=true`.

A fase é validada por `occurred_at`. Um assignment fechado no presente continua
válido para um evento cujo timestamp pertence à antiga janela half-open.

### Quarentena sem fabricação

`aba_sync_quarantine_v3` preserva o payload original quando ele não pode ser
interpretado com segurança. Não existe mapeamento manual para uma versão diferente.
Uma versão ausente só fica pronta para retry quando o mesmo UUID original aparece
no servidor. Caso não seja recuperável, o evento pode ser `DISCARDED` com motivo e
auditoria, nunca transformado em dado clínico de outra versão.

Erros de escopo cross-tenant são tratados separadamente e falham fechados, pois não
são incerteza clínica legítima.

### Exposure

`NO_OPPORTUNITY` permanece um estado explícito sem trial falso. Quando o primeiro
trial válido chega, o estado corrente é promovido a `COLLECTED`. O bulk faz isso
uma única vez por sessão + target, mesmo quando dezenas de trials chegam juntos.
A transição anterior continua no log append-only.

### Limites deste PR

PR3 não cria summaries, não avalia maestria/FSM, não cria observation slices e não
muda frontend. Todas as tabelas e RPCs novas continuam sem acesso de `anon` ou
`authenticated`; somente `service_role` pode usá-las.

## 16. PR4 — summaries canônicos e reconciliação server-side

PR4 introduz `aba_session_target_summaries_v3` como projeção rebuildable por
`session_id + target_id + target_phase_assignment_id`. A granularidade por fase é
obrigatória: se um target muda de fase dentro da mesma sessão, cada segmento possui
summary próprio e os gráficos futuros não precisam unir semanticamente essas séries.

A autoridade continua sendo `aba_trials_v3 + aba_trial_steps_v3 + revisões append-only`.
O browser não envia `accuracyPercent`, `independencePercent` ou qualquer percentual
como verdade clínica.

### Projeção efetiva e revisões

A última revisão clínica não-`ANNOTATE` determina a efetividade do envelope:

- sem revisão ou `RESTORE` -> trial efetivo;
- `VOID`, `CORRECT` ou `SUPERSEDE` -> envelope original fora da projeção;
- replacement trial é outro envelope imutável e possui ciclo de revisão próprio.

Uma revisão recalcula apenas o target/fase envolvido, na mesma transação. Não existe
job assíncrono deixando o gráfico temporariamente divergente após uma retificação.
Para `CORRECT`/`SUPERSEDE`, `record_aba_trial_correction_v3(...)` grava o replacement
e a revisão dentro da mesma transação, impedindo uma janela visível de dupla contagem.

### Matemática de independência

A unidade do denominador é o **trial**, não o step. Um complex trial com vários
prompts/correções contribui no máximo 1 vez porque só pode existir um step
`PRIMARY_INDEPENDENT` por envelope.

`primary_independence_percent = primary_independent_correct_count /
eligible_independent_opportunity_count * 100`.

Quando `eligible_independent_opportunity_count = 0`, o percentual é `NULL` (`N/A`),
nunca `0%`. Respostas concluídas após suporte são registradas separadamente e não
inflam independência. Prompts são resumidos como `prompt_step_counts`: contagem
objetiva de steps por `prompt_key`. PR4 não transforma complex trials em uma falsa
distribuição percentual de prompts por trial.

### Economia e concorrência

O bulk do PR3 insere todos os steps de uma chamada em um único statement. Um trigger
statement-level usa a transition table para descobrir os segmentos distintos tocados
e recalcula cada `session + target + phase` uma única vez. Portanto o custo de
reconciliação cresce com os targets/fases afetados, não com o número de trials.

Cada segmento possui advisory transaction lock próprio; targets diferentes não
competem pelo mesmo summary.

### Verificação

Cada summary persiste `source_projection_hash` e `summary_definition_version`.
`verify_aba_session_target_summary_v3(...)` recalcula a projeção diretamente do raw
efetivo e informa se o cache é idêntico sem modificar nenhum dado.

PR4 continua dark/service-role only, não altera ABA Legacy V2 e não habilita novos
bindings V3.

## PR5 — motor de comportamentos, rate e duração

- tempo de observação é líquido e fragmentável; duração total da sessão não substitui denominador ausente;
- contexto é normalizado e faz parte do segmento de coleta;
- collector binding congela `PRIMARY` ou `RELIABILITY`; apenas PRIMARY alimenta o summary oficial;
- overlaps são protegidos por collector binding, permitindo comportamentos/observadores distintos simultaneamente;
- frequência e rate são dimensões separadas; rate fica `NULL` sem tempo observado válido;
- episódios de duração esquecidos no encerramento são censurados à direita e sinalizados para revisão;
- nenhuma tabela V2 é alterada e nenhum rollout é ativado no PR5.

## PR6 — probes, fechamento transacional e FSM clínica

PR6 cria snapshots imutáveis de critérios em `aba_mastery_criterion_versions_v3`. Não há 80% implícito: sem mínimo de oportunidades, threshold e número de sessões explicitamente configurados, a avaliação automática de maestria permanece desligada.

Probes de manutenção separam lifecycle de interpretação. `OPEN`, `COMPLETE`, `INCOMPLETE` e `CANCELLED` descrevem o bloco de coleta. Apenas `COMPLETE + ELIGIBLE` pode produzir `PASSED` ou `BELOW_CRITERION`; `INCOMPLETE` nunca é contado como falha. No encerramento da sessão, nenhuma probe `OPEN` sobrevive: se possui oportunidades elegíveis suficientes vira `COMPLETE`, caso contrário `INCOMPLETE`.

A FSM V3 é versionada e auditável. As únicas transições automáticas são `ACQUISITION/REACQUISITION -> MASTERY_CRITERIA_MET` por critérios explícitos e `MAINTENANCE -> MAINTENANCE_ALERT` após o número congelado de probes completas/elegíveis consecutivas abaixo do critério. Maestria final e retorno para reaquisição permanecem decisões humanas.

A inicialização do estado clínico V3 é explícita; a Verto não infere estado clínico atual a partir do Legacy V2.

Uma retificação posterior de trial ligado a uma probe encerrada não recalcula silenciosamente a decisão histórica: a probe é marcada `STALE_REVIEW_REQUIRED`, fica fora de novos contadores de alerta e exige revisão clínica. Correções de trials enquanto a probe ainda está `OPEN` podem vincular atomicamente o replacement válido ao mesmo bloco.

`finalize_aba_session_measurements_v3` fecha timers, resolve exposures pendentes, fecha probes, reconcilia summaries e avalia a FSM. `complete_aba_session_v3` compõe a completion V2 já existente com a finalização V3 dentro da mesma transação para suportar futuras sessões híbridas sem aceitar summary V3 vindo do browser.

PR6 continua dark/service-role only, não altera frontend e não habilita `allow_new_v3_sessions`.

## PR7 — Task Analysis, intervalos e IOA

PR7 adiciona motores V3 próprios para medidas que não devem ser convertidas em trials DTT genéricos.

Task Analysis usa definições relacionais e imutáveis por versão de coleta. Cada run representa uma travessia da cadeia e cada step mantém um resultado categórico. Não há score ponderado de prompt. O summary de chaining é independente do summary DTT e usa somente passos elegíveis realmente observados no denominador. Correções ocorrem por revisões append-only.

Interval recording possui um `aba_interval_runs_v3` compartilhado como grid temporal. O primary collector fica congelado no run; observadores `RELIABILITY` registram no mesmo grid sem alimentar o resultado oficial do paciente. `PARTIAL_INTERVAL`, `WHOLE_INTERVAL` e `MOMENTARY_TIME_SAMPLING` preservam suas identidades metodológicas, e `NOT_OBSERVED` nunca é convertido em ausência do comportamento. Para MTS, o instante de amostragem é derivado do grid no servidor.

A ingestão bulk de intervalos é idempotente e isola conflitos de uma célula em quarentena sem abortar o restante do lote. Correções são append-only e summaries são projeções server-side. No fechamento da sessão, interval runs abertos viram `COMPLETE` ou `PARTIAL`; nunca permanecem eternamente `OPEN`.

IOA fica em uma projeção separada. O summary oficial continua PRIMARY-only. Frequência usa total-count IOA, duração usa total-duration IOA e intervalos usam interval-by-interval IOA. Total count/duration exigem janelas de observação alinhadas; caso contrário a Verto retorna `N/A/requires_review`, sem fabricar concordância. Duração censurada também invalida o score automático.

A antiga tela Legacy V2 de “Tipos de ajuda ABA” permanece sem mudança visual neste PR. A pontuação 0–100 será removida/descontinuada na interface V3 do PR9, quando prompts forem apresentados categoricamente e sem semântica falsa de independência.
