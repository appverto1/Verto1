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

## PR8 — read models canônicos e fronteira Node

PR8 cria a primeira superfície de leitura suportada da V3. O browser continua sem acesso direto às tabelas e views clínicas: três RPCs server-side entregam bundles já filtrados por `organization_id + patient_id + session/target`, e o Node aplica autenticação, capability e checagem de escopo antes da chamada.

A leitura de sessão é consolidada em uma única RPC para evitar N+1 entre configuração, summaries DTT, Task Analysis, comportamento, intervalos, IOA e probes. O overview do paciente usa outra RPC pequena e o histórico de target é temporalmente limitado, com teto server-side de 180 registros por família e janela máxima de 366 dias.

Somente projeções canônicas são expostas. Comportamento e intervalos vêm das views oficiais `PRIMARY`; IOA permanece em coleção separada e nunca é fundido ao resultado clínico do paciente. Raw events, revisões e payloads offline não fazem parte do read path padrão.

Prompts continuam categóricos: os read models carregam `prompt_step_counts`/`prompt_counts`, jamais `independence_score` ou `response_score`. O histórico também preserva `phase_assignment_id`; a transformação em `series_segments` e o renderer que impede linhas atravessando mudança de fase pertencem ao PR10.

O endpoint V3 fica atrás de `FEATURE_ABA_V3_READ_API=false` por padrão. PR8 não ativa rollout, não altera nenhuma tabela/rota V2 e não muda React. A tela Legacy V2 **Tipos de ajuda ABA** permanece intocada até o PR9, quando a interface V3 removerá a semântica visual de pontuação 0–100 dos prompts.

## PR9A — UI categórica de tentativas e ponte transacional de escrita

PR9A adiciona a primeira experiência React preparada para tentativas V3 sem substituir o Legacy V2. O binding `session + target` é resolvido pelo Node e cacheado na sessão; depois de criado, o snapshot imutável do PR2 decide qual fluxo persiste aquele target. Falha ao resolver um binding novo é fail-closed: a UI não adivinha V2.

Na V3, a interface deixa de tratar tipos de ajuda como uma escala 0–100. Os comandos clínicos são `INDEPENDENT_CORRECT`, `INDEPENDENT_INCORRECT`, `NO_RESPONSE` e `PROMPTED_CORRECT`. Para tentativa com ajuda, o servidor relê o prompt persistido no tenant e transforma a intenção em steps categóricos; o browser não envia score, versão de protocolo, fase clínica nem steps como autoridade.

A escrita passa por `/api/aba/v3/trials`, protegida por feature flag, autenticação, capability, escopo de paciente/sessão e limites de payload. O Node faz uma única RPC transacional por tentativa; a RPC resolve/revalida o binding no banco e injeta versão/fase imutáveis antes do motor PR3. A UI usa o outbox `aba_v3`, preservando a tentativa em caso de indisponibilidade de rede sem redirecioná-la para a tabela Legacy.

Sondagens de manutenção usam `record_aba_trial_action_v3(...)`, que compõe trial + abertura/reuso da probe + vínculo na mesma transação. Replays após finalização reconhecem vínculo existente sem reabrir probe encerrada. O encerramento da sessão usa `complete_aba_session_v3(...)` somente quando `FEATURE_ABA_V3_COLLECTION_API` está ligado; com a flag desligada, o caminho V2 anterior permanece idêntico.

Sessões puramente V2 preservam o cálculo Legacy local. Quando existe trial V3, o resumo local não mistura `independence_score` 0–100 com a semântica categórica: oportunidades independentes explícitas formam o denominador e `PROMPTED_CORRECT` não o infla. A projeção server-side continua sendo a autoridade clínica.

`FEATURE_ABA_V3_COLLECTION_API` e `VITE_FEATURE_ABA_V3_UI` ficam `false` por padrão. PR9A não altera rollout, não habilita `allow_new_v3_sessions` e não converte dados históricos V2.

O escopo de coleta desta etapa é deliberadamente restrito a targets `dtt`, `net` e `probe`. Targets `behavior` e `task_analysis` são recusados **antes** de criar um binding V3 pela rota Node e são revalidados dentro da RPC transacional. Isso evita que comportamento, intervalos ou task analysis caiam silenciosamente nos writers Legacy enquanto a UI V3 dessas famílias ainda não existe.

A próxima etapa é **PR9B**: UI/ingestão canônica V3 para comportamento, intervalos e task analysis. Somente depois dessa fronteira estar completa a sequência avança para gráficos V3 segmentados por fase/modelo.

## PR9B — comportamento, intervalos e Task Analysis na coleta V3

PR9B fecha as famílias clínicas que permaneceram deliberadamente bloqueadas no PR9A. O princípio continua sendo o mesmo: uma decisão V3 nunca pode cair silenciosamente em um writer Legacy V2.

### Comportamento com identidade explícita

`aba_behavior_definitions` continua sendo a identidade canônica do comportamento observado. A UI não traduz presets simbólicos por nome e não tenta encontrar um target “parecido”. A relação entre um comportamento e um target V3 é persistida explicitamente em `aba_behavior_target_bindings_v3`.

O vínculo ativo é único por `organization + patient + behavior`. Uma correção não reescreve o vínculo antigo: ele transita para `ARCHIVED` com ator, timestamp e motivo obrigatório, e um novo vínculo pode ser criado para sessões futuras. A identidade do vínculo não pode ser atualizada nem removida.

Na primeira resolução de um comportamento canônico dentro de uma sessão, `aba_session_behavior_collection_bindings_v3` congela a decisão `sessão + comportamento`. Isso inclui decisões Legacy por ausência de mapeamento. Arquivar/revincular a configuração depois não muda uma sessão em andamento e bindings `session + target` já materializados permanecem imutáveis.

A resolução da coleta segue duas etapas canônicas: comportamento explícito -> target explícito -> `resolve_aba_session_target_measurement_binding_v1`. Comportamento sem vínculo explícito permanece Legacy V2; não há backfill ou inferência por label.

### Frequência, taxa e duração

A UI carrega um catálogo pequeno do paciente (`id`, `name`, `measurement_type`, `interval_seconds`, `status`) uma vez e o reaproveita no estado da sessão. Escritas V3 passam por `/api/aba/v3/behavior-actions` e por uma única RPC de ação.

Frequência e ocorrências de rate são fatos append-only. Duração usa início/fim de episódio com `client_event_id` idempotente. Rate usa slices explícitos de observação; a duração da sessão inteira nunca é usada como denominador implícito. O collector PRIMARY é congelado por sessão + comportamento + contexto e um segundo PRIMARY concorrente é rejeitado.

ABC ainda não possui modelo V3 próprio. Se um comportamento já estiver resolvido como V3, a UI bloqueia a gravação ABC em vez de persistir na tabela Legacy. Isso é um limite clínico explícito, não um fallback.

### Interval recording

A criação de um run de intervalo exige confirmação server-side e retorna o UUID canônico antes de iniciar a grade local. Cada célula é escrita na superfície PR7 e o encerramento chama a finalização canônica; lifecycle/summaries Legacy não são duplicados.

Como PR7 representa uma grade temporal fixa, a pausa Legacy não é reinterpretada na V3. A UI bloqueia pausa durante um run V3 até existir uma semântica própria que preserve corretamente o denominador. `NOT_OBSERVED` continua distinto de ausência de comportamento.

### Task Analysis

Targets `task_analysis` passam a poder resolver binding V3. A definição dos passos vem do snapshot imutável da versão de coleta e a UI registra uma travessia completa com resultados categóricos por passo: `INDEPENDENT`, `PROMPTED`, `INCORRECT`, `NO_RESPONSE`, `NOT_OBSERVED` ou `NOT_APPLICABLE`.

`PROMPTED` exige um prompt ativo e visível da clínica, validado novamente no servidor/banco. Nenhum `independence_score` ou `response_score` é aceito. O run é persistido atomicamente pelo motor PR7, não como uma sequência de trials DTT independentes.

### Append-only e fronteira Node

Registros V3 de comportamento não podem ser editados ou apagados pela interface Legacy. Correções futuras devem usar as superfícies de revisão V3 já previstas; a UI identifica esses registros como imutáveis.

Toda a coleta segue `browser -> Node autenticado/autorizado -> RPC service_role`. O browser não possui acesso direto às novas tabelas/RPCs. Rotas aplicam feature flag, autenticação, capability, escopo do paciente/sessão e limites de payload. O catálogo lê apenas colunas essenciais e é reutilizado no estado da sessão, evitando uma consulta por clique.

O outbox `aba_v3` continua preservando eventos offline e processa mutações em ordem causal. Operações estruturais que precisam de um ID server-side, como criar um interval run, aguardam confirmação canônica antes de abrir estado local dependente desse ID.

### Rollout

PR9B permanece dark. `FEATURE_ABA_V3_READ_API`, `FEATURE_ABA_V3_COLLECTION_API` e `VITE_FEATURE_ABA_V3_UI` continuam `false` por padrão e a migration não habilita `allow_new_v3_sessions`.

Com o PR9B, a superfície principal de coleta V3 fica fechada para DTT/NET/probe, comportamento, intervalos e Task Analysis. A próxima etapa é **PR10**: gráficos V3 segmentados por fase/modelo, configuração operacional do piloto e gates/smoke tests de rollout antes de qualquer ativação em produção.

## PR10 — gráficos segmentados e gates operacionais de piloto

PR10 cria o read model de gráficos V3 por `series_segments`. Cada segmento é identificado por modelo + fase + métrica + série; o frontend usa uma `Line` distinta por segmento e não conecta fases diferentes. O painel Legacy V2 continua separado, então uma troca V2 -> V3 jamais vira uma linha contínua artificial.

O gráfico V3 cobre DTT/NET/probe, Task Analysis, manutenção, frequência, taxa, duração e interval recording. IOA continua separado do resultado clínico oficial. A API lê apenas projeções server-side canônicas; raw events e revisões não são carregados no hot path.

ABC permanece Legacy V2 no primeiro piloto. Novos vínculos V3 de comportamento ABC são recusados no banco e qualquer vínculo ABC V3 ativo aparece como blocker de readiness. Não existe backfill nem equivalência inventada.

O rollout ganha duas superfícies operacionais service-role: `get_aba_v3_pilot_readiness(...)` e `set_aba_measurement_rollout_state_v3(...)`. O writer é restrito a `platform_admins`, usa optimistic locking, advisory lock, auditoria existente e preflight obrigatório para `PROGRAM/TARGET`. O Node acrescenta `FEATURE_ABA_V3_ROLLOUT_ADMIN=false` por padrão e recusa ativação se leitura, coleta ou UI V3 ainda não estiverem ligadas no runtime.

Rollback é em duas fases: bloquear novas sessões V3 (`allow_new_v3_sessions=false`) mantendo sync ativo para drenar eventos existentes; somente depois desligar `accept_v3_sync`. Dados e bindings históricos nunca são reescritos.

## PR11 — fronteira pré-produção e isolamento real do piloto

PR11 remove a última dependência global da UI V3 sobre sessões Legacy. O frontend passa a carregar **um plano de coleta por sessão** em uma única RPC, limitado aos targets que já estão no plano da sessão e aos vínculos comportamentais V3 ativos. Esse plano é somente leitura: ele antecipa a decisão pelo `session.started_at`, mas não cria bindings. A resolução histórica dos gates CLINIC/PATIENT/PROGRAM/TARGET é carregada em lote dentro da mesma consulta, evitando resolver rollout separadamente por target. Bindings continuam sendo materializados apenas no primeiro fato clínico V3.

Com o plano disponível, targets `LEGACY_V2` não chamam o resolver V3 por clique, não criam rows auxiliares e continuam usando exatamente os prompts/presets Legacy. Somente targets cuja decisão prevista é `V3` recebem a semântica categórica. Comportamentos canônicos substituem um preset Legacy apenas quando o `behavior_id` está explicitamente ligado a um target V3 naquele episódio. Um binding comportamental já congelado na sessão prevalece mesmo se o mapeamento administrativo for arquivado depois. Falha ou inconsistência de plano nunca autoriza fallback silencioso de um target V3 para um writer V2.

Enquanto V2 e V3 coexistirem, a configuração global de tipos de ajuda continua exibindo os campos necessários ao Legacy V2; o score existe apenas como compatibilidade para sessões V2 e não entra em cálculo V3. A configuração global só assume semântica puramente categórica quando V2 deixar de estar habilitado.

A flag `VITE_FEATURE_ABA_V3_UI` deixa de aceitar opt-in por `localStorage`: habilitação clínica depende do build/runtime e, principalmente, do rollout server-side. A API de preflight também é separada da API de mutação: `FEATURE_ABA_V3_PREFLIGHT_API` pode ser habilitada para smoke/readiness sem abrir o writer de rollout.

`get_aba_v3_rollout_drain_status(...)` contabiliza sessões V3 abertas, interval runs abertos, slices de observação abertos, episódios de duração não encerrados e quarentena não resolvida. O writer de rollout passa a rejeitar `allow_new_v3_sessions=true` quando `accept_v3_sync=false` e também rejeita desligar sync enquanto o escopo não estiver drenado.

A ordem de rollback permanece: (1) `allow_new_v3_sessions=false` com sync ainda ativo; novos targets sem binding voltam a `LEGACY_V2`, enquanto bindings V3 já congelados continuam V3; (2) aguardar drenagem e resolver quarentena; (3) somente então `accept_v3_sync=false`; (4) confirmar `drain-status` novamente. Se surgir fato offline tardio, `accept_v3_sync=true` pode ser reabilitado sozinho, sem reabrir novas sessões V3 e sem depender de UI/coleta estarem ligadas. O preflight de readiness é exigido para **abrir novas sessões V3**, não para manter/reabilitar sync de recuperação. O smoke PR11 é estritamente read-only e nunca chama `/api/aba/v3/admin/rollout-state`.
